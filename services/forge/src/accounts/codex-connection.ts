import { createLogger } from "@homelab-paas/backend-infrastructure/logger";
import type { ISleep } from "@homelab-paas/backend-infrastructure/sleep";
import { z } from "zod";

import type { IAccountProcess } from "./account-process.ts";
import type { AccountNotification, AccountProcessHandle, IAccountDiagnostics } from "./types.ts";

export class CodexConnectionError extends Error {
	constructor(options?: ErrorOptions) {
		super("Codex connection unavailable", options);
		this.name = "CodexConnectionError";
	}
}
export interface ICodexConnection {
	/** Idempotent initialization. Reconnects only when explicitly called; never replays a request. */
	initialize(): Promise<void>;
	/** Explicit user retry/cancel can reset an uncertain connection; never replays old work. */
	restart(): Promise<void>;
	/** Private allowlisted account operations only. Throws CodexConnectionError. */
	request(method: string, params: unknown): Promise<unknown>;
	subscribe(listener: AccountNotification): () => void;
	close(): Promise<void>;
}
interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: AbortController;
}
const initializeSchema = z.object({
	userAgent: z.string().min(1).max(4096),
	codexHome: z.string().min(1).max(4096),
	platformFamily: z.string(),
	platformOs: z.string(),
});
const methods = new Map<string, z.ZodType>([
	["account/read", z.strictObject({ refreshToken: z.boolean().optional() })],
	["account/login/start", z.strictObject({ type: z.literal("chatgptDeviceCode") })],
	["account/login/cancel", z.strictObject({ loginId: z.string().min(1).max(256) })],
]);

export class CodexConnection implements ICodexConnection {
	private handle: AccountProcessHandle | undefined;
	private initialization: Promise<void> | undefined;
	private stopping: Promise<void> = Promise.resolve();
	private closed = false;
	private buffer = "";
	private sequence = 0;
	private readonly pending = new Map<number, PendingRequest>();
	private readonly listeners = new Set<AccountNotification>();
	constructor(
		private readonly processes: IAccountProcess,
		private readonly sleep: ISleep,
		private readonly deadlineMs: number = 15_000,
		private readonly log: IAccountDiagnostics = createLogger(CodexConnection.name),
	) {}
	async initialize(): Promise<void> {
		if (this.closed) throw new CodexConnectionError();
		this.initialization ??= this.connect();
		return this.initialization;
	}
	async request(method: string, params: unknown): Promise<unknown> {
		const schema = methods.get(method);
		if (!schema) throw new Error("Unsupported Codex operation");
		const parsed = schema.safeParse(params);
		if (!parsed.success) throw new Error("Invalid Codex operation input");
		if (!this.handle || !this.initialization) throw new CodexConnectionError();
		await this.initialization;
		return this.send(method, parsed.data);
	}
	subscribe(listener: AccountNotification): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	async restart(): Promise<void> {
		this.disconnect(new Error("Explicit account connection reset"), true);
		await this.stopping;
		await this.initialize();
	}
	async close(): Promise<void> {
		this.closed = true;
		this.disconnect(new Error("Forge shutting down"), true);
		await this.stopping;
	}
	private async connect(): Promise<void> {
		await this.stopping;
		if (this.closed) throw new CodexConnectionError();
		try {
			await this.processes.initialize();
			if (this.closed) throw new CodexConnectionError();
			const handle = this.processes.spawn({
				program: "codex",
				arguments: ["app-server", "-c", 'cli_auth_credentials_store="file"'],
				onOutput: (chunk) => {
					if (this.handle === handle) this.receive(chunk);
				},
			});
			this.handle = handle;
			this.buffer = "";
			void handle.done.then(
				() => {
					if (this.handle === handle) this.disconnect(new Error("Codex exited"));
				},
				(cause: unknown) => {
					if (this.handle === handle) this.disconnect(cause);
				},
			);
			initializeSchema.parse(
				await this.send("initialize", {
					clientInfo: { name: "forge", version: "0.1.0" },
					capabilities: { experimentalApi: false },
				}),
			);
			if (this.handle !== handle) throw new CodexConnectionError();
			handle.write(JSON.stringify({ method: "initialized" }) + "\n");
		} catch (cause) {
			this.disconnect(cause);
			throw new CodexConnectionError({ cause });
		}
	}
	private send(method: string, params: unknown): Promise<unknown> {
		const handle = this.handle;
		if (!handle || this.pending.size >= 32) return Promise.reject(new CodexConnectionError());
		const id = ++this.sequence;
		return new Promise((resolve, reject) => {
			const timer = new AbortController();
			this.pending.set(id, { resolve, reject, timer });
			void this.sleep(this.deadlineMs, timer.signal).then(
				() => {
					if (this.pending.has(id)) this.disconnect(new Error("Codex request deadline exceeded"));
				},
				() => {},
			);
			try {
				handle.write(JSON.stringify({ id, method, params }) + "\n");
			} catch (cause) {
				this.disconnect(cause);
			}
		});
	}
	private receive(chunk: string): void {
		try {
			this.buffer += chunk;
			let newline: number;
			while ((newline = this.buffer.indexOf("\n")) >= 0) {
				if (Buffer.byteLength(this.buffer.slice(0, newline)) > 1024 * 1024)
					throw new Error("Codex frame exceeded limit");
				const line = this.buffer.slice(0, newline);
				this.buffer = this.buffer.slice(newline + 1);
				if (line.trim()) this.message(JSON.parse(line));
			}
			if (Buffer.byteLength(this.buffer) > 1024 * 1024) throw new Error("Codex frame exceeded limit");
		} catch (cause) {
			this.disconnect(cause);
		}
	}
	private message(value: unknown): void {
		const message = z
			.object({
				id: z.union([z.number().int().nonnegative(), z.string()]).optional(),
				method: z.string().max(256).optional(),
				params: z.unknown().optional(),
				result: z.unknown().optional(),
				error: z.object({ code: z.number(), message: z.string() }).optional(),
			})
			.parse(value);
		if (message.method) {
			if (message.id !== undefined) {
				// No execution/approval requests are supported in slice 1; reject rather than leave a server request hanging.
				this.handle?.write(
					JSON.stringify({ id: message.id, error: { code: -32601, message: "Method not supported" } }) + "\n",
				);
			} else for (const listener of this.listeners) listener(message.method, message.params);
			return;
		}
		if (typeof message.id !== "number") throw new Error("Invalid Codex response envelope");
		const pending = this.pending.get(message.id);
		if (!pending) throw new Error("Unexpected Codex response");
		this.pending.delete(message.id);
		pending.timer.abort();
		if (message.error) pending.reject(new CodexConnectionError({ cause: new Error(message.error.message) }));
		else if ("result" in message) pending.resolve(message.result);
		else {
			pending.reject(new CodexConnectionError());
			throw new Error("Missing Codex result");
		}
	}
	private disconnect(cause: unknown, expected = false): void {
		const handle = this.handle;
		this.handle = undefined;
		this.initialization = undefined;
		this.buffer = "";
		for (const pending of this.pending.values()) {
			pending.timer.abort();
			pending.reject(new CodexConnectionError({ cause }));
		}
		this.pending.clear();
		if (handle) {
			if (!expected) this.log.warn({ err: cause }, "Codex disconnected; pending work will not be replayed");
			if (!this.closed) for (const listener of this.listeners) listener("connection/lost", {});
			this.stopping = handle.stop().catch((err: unknown) => {
				this.log.error({ err }, "Codex process cleanup failed");
			});
		}
	}
}
