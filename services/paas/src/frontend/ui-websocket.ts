import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";

import { uiLiveClientSchema } from "@homelab-paas/shared-contracts";
import { WebSocket, WebSocketServer } from "ws";

import { createLogger } from "../util/logger.ts";
import type { ISleep } from "../util/sleep.ts";
import type { UiSessionVerifier } from "./paas-ui-router.ts";
import type { IUiLiveService } from "./ui-live-service.ts";

/** Owns upgrade authentication and bounded WebSocket I/O. No domain aggregation here. */
export class UiWebSocket {
	private readonly log = createLogger(UiWebSocket.name);
	private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
	private server?: Server;
	private readonly upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
		if (request.url !== "/api/ui/live") {
			socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
			return;
		}
		if (request.headers.origin !== this.origin() || !this.authorized(request) || this.sockets.clients.size >= 128) {
			socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
			return;
		}
		this.sockets.handleUpgrade(request, socket, head, (ws) => this.connect(ws, request));
	};
	constructor(
		private readonly live: IUiLiveService,
		private readonly origin: () => string,
		private readonly sessions: UiSessionVerifier | undefined,
		private readonly sleep: ISleep,
	) {}
	attach(server: Server): void {
		this.server = server;
		server.on("upgrade", this.upgrade);
	}
	async close(): Promise<void> {
		this.server?.off("upgrade", this.upgrade);
		for (const ws of this.sockets.clients) ws.terminate();
		await new Promise<void>((resolve) => this.sockets.close(() => resolve()));
	}
	private authorized(request: IncomingMessage): boolean {
		if (!this.sessions) return true;
		const cookies = (request.headers.cookie ?? "")
			.split(";")
			.map((part) => part.trim())
			.filter((part) => part.startsWith("__Secure-paas_session="));
		if (cookies.length !== 1) return false;
		try {
			return Boolean(
				this.sessions.verifyAuthCookie(decodeURIComponent(cookies[0]!.slice("__Secure-paas_session=".length))),
			);
		} catch {
			return false;
		}
	}
	private connect(ws: WebSocket, request: IncomingMessage): void {
		const controller = new AbortController();
		const subscriptions = new Map<string, () => void>();
		const cleanup = (): void => {
			controller.abort();
			for (const cancel of subscriptions.values()) cancel();
			subscriptions.clear();
		};
		const close = (code: number, reason: string): void => {
			cleanup();
			ws.close(code, reason);
		};
		ws.on("close", cleanup);
		ws.on("error", (err) => {
			this.log.error({ err }, "Management WebSocket failed");
			cleanup();
			ws.terminate();
		});
		ws.on("message", (bytes, binary) => {
			if (!this.authorized(request)) {
				close(1008, "Session expired");
				return;
			}
			try {
				if (binary) {
					close(1003, "Text messages required");
					return;
				}
				const parsed = uiLiveClientSchema.safeParse(JSON.parse(bytes.toString()));
				if (!parsed.success) {
					close(1008, "Invalid subscription");
					return;
				}
				const message = parsed.data;
				subscriptions.get(message.id)?.();
				subscriptions.delete(message.id);
				if (message.type === "unsubscribe") return;
				if (subscriptions.size >= 16) {
					close(1008, "Too many subscriptions");
					return;
				}
				const cancel = this.live.subscribe(message.id, message.target, (event) => {
					if (controller.signal.aborted || ws.readyState !== WebSocket.OPEN) return;
					if (!this.authorized(request)) {
						close(1008, "Session expired");
						return;
					}
					const payload = JSON.stringify(event);
					if (Buffer.byteLength(payload) + ws.bufferedAmount > 16777216) {
						close(1009, "Client cannot keep up");
						return;
					}
					ws.send(payload, (err) => {
						if (err) {
							this.log.error({ err }, "Management WebSocket send failed");
							cleanup();
							ws.terminate();
						}
					});
				});
				if (controller.signal.aborted) cancel();
				else subscriptions.set(message.id, cancel);
			} catch (err) {
				this.log.error({ err }, "Invalid management WebSocket message");
				close(1008, "Invalid subscription");
			}
		});
		void this.monitor(ws, request, controller.signal, close);
	}
	private async monitor(
		ws: WebSocket,
		request: IncomingMessage,
		signal: AbortSignal,
		close: (code: number, reason: string) => void,
	): Promise<void> {
		let ticks = 0;
		let alive = true;
		ws.on("pong", () => {
			alive = true;
		});
		try {
			while (!signal.aborted) {
				await this.sleep(1000, signal);
				if (signal.aborted) return;
				if (!this.authorized(request)) {
					close(1008, "Session expired");
					return;
				}
				if (++ticks % 30 === 0) {
					if (!alive) {
						ws.terminate();
						return;
					}
					alive = false;
					ws.ping();
				}
			}
		} catch (err) {
			if (!signal.aborted) {
				this.log.error({ err }, "Management WebSocket monitor failed");
				close(1011, "Connection unavailable");
			}
		}
	}
}
