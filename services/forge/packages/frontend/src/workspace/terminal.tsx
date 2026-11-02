import {
	terminalSessionSchema,
	terminalStatusSchema,
	terminalServerMessageSchema,
} from "@homelab-paas/forge-contracts/terminal";
import type { TerminalSession } from "@homelab-paas/forge-contracts/terminal";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";

import type { IWorkspaceApi } from "../api/workspace-api.ts";
import { TerminalStream } from "./terminal-stream.ts";

import "@xterm/xterm/css/xterm.css";

export const WorkspaceTerminal = ({ id, api }: { id: string; api: IWorkspaceApi }) => {
	const [session, setSession] = useState<TerminalSession>();
	const [connection, setConnection] = useState("");
	const [error, setError] = useState("");
	const [gap, setGap] = useState<number>();
	const [busy, setBusy] = useState(true);
	const element = useRef<HTMLDivElement>(null);
	const terminal = useRef<Terminal | undefined>(undefined);
	const fit = useRef<FitAddon | undefined>(undefined);
	const socket = useRef<WebSocket | undefined>(undefined);
	const stream = useRef<TerminalStream | undefined>(undefined);
	const attachment = useRef(0);
	const retainedSession = useRef<string | undefined>(undefined);
	const active = session?.status === "running" || session?.status === "starting";
	const send = useCallback((value: object) => {
		if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(value));
	}, []);
	const attach = useCallback(
		async (value: TerminalSession) => {
			const generation = ++attachment.current;
			const oldSocket = socket.current;
			socket.current = undefined;
			oldSocket?.close();
			const transcript = stream.current;
			if (!transcript) return;
			const after = await transcript.prepare(value.id);
			if (stream.current !== transcript || attachment.current !== generation) return;
			if (retainedSession.current !== value.id) setGap(undefined);
			retainedSession.current = value.id;
			const url = new URL(`/api/terminals/${value.id}/socket`, window.location.href);
			url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
			url.searchParams.set("after", String(after));
			const current = new WebSocket(url);
			socket.current = current;
			setConnection("Connecting…");
			current.onopen = () => {
				if (socket.current !== current) return;
				setConnection("Connected");
				fit.current?.fit();
				if (terminal.current)
					send({
						type: "resize",
						cols: Math.max(2, Math.min(500, terminal.current.cols)),
						rows: Math.max(1, Math.min(200, terminal.current.rows)),
					});
			};
			current.onclose = () => {
				if (socket.current === current) setConnection("Disconnected. Reconnect to the same shell.");
			};
			current.onerror = () => {
				if (socket.current === current) setError("Terminal connection failed. Reconnect explicitly.");
			};
			current.onmessage = (event) => {
				if (socket.current !== current) return;
				let message: unknown;
				try {
					message = JSON.parse(String(event.data));
				} catch {
					setError("Invalid terminal response");
					current.close();
					return;
				}
				const parsed = terminalServerMessageSchema.safeParse(message);
				if (!parsed.success) {
					setError("Invalid terminal response");
					current.close();
					return;
				}
				const frame = parsed.data;
				if (frame.type === "output") transcript.output(frame.sequence, frame.data);
				else if (frame.type === "gap") {
					transcript.gap(frame.through);
					setGap(frame.through);
				} else if (frame.session.id === value.id && frame.session.workspaceId === id) setSession(frame.session);
			};
		},
		[id, send],
	);
	useEffect(() => {
		if (!element.current) return;
		const view = new Terminal({ cursorBlink: true, cols: 80, rows: 24, scrollback: 1000 });
		const addon = new FitAddon();
		view.loadAddon(addon);
		view.open(element.current);
		terminal.current = view;
		fit.current = addon;
		const transcript = new TerminalStream(view);
		stream.current = transcript;
		view.onData((data) => {
			for (const frame of transcript.input(data))
				if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(frame);
		});
		view.onResize(({ cols, rows }) =>
			send({ type: "resize", cols: Math.max(2, Math.min(500, cols)), rows: Math.max(1, Math.min(200, rows)) }),
		);
		const observer = new ResizeObserver(() => addon.fit());
		observer.observe(element.current);
		let disposed = false;
		void api
			.read(`workspaces/${id}/terminal`, terminalStatusSchema)
			.then(async (value) => {
				if (disposed) return;
				setSession(value.session);
				if (value.session) await attach(value.session);
			})
			.catch(() => {
				if (!disposed) setError("Terminal status unavailable. Refresh to inspect before creating a shell.");
			})
			.finally(() => {
				if (!disposed) setBusy(false);
			});
		return () => {
			disposed = true;
			observer.disconnect();
			const current = socket.current;
			socket.current = undefined;
			current?.close();
			view.dispose();
			terminal.current = undefined;
			fit.current = undefined;
			stream.current = undefined;
		};
	}, [id, api, attach, send]);
	const run = async (action: () => Promise<void>) => {
		setBusy(true);
		setError("");
		try {
			await action();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Terminal unavailable");
		} finally {
			setBusy(false);
		}
	};
	return (
		<section aria-label='Terminal'>
			<h3>Terminal</h3>
			<p>Shell: {session?.status ?? "none"}</p>
			{session?.exitCode !== undefined && <p>Exit code {session.exitCode}</p>}
			<p>{connection}</p>
			{error && (
				<p role='alert' className='error'>
					{error}
				</p>
			)}
			{gap !== undefined && (
				<p className='notice'>Output gap through {gap}. Some terminal output is unavailable.</p>
			)}
			<div className='terminal-view' ref={element} />
			<div className='toolbar'>
				<button
					disabled={busy || active}
					onClick={() =>
						void run(async () => {
							const value = await api.read(`workspaces/${id}/terminal`, terminalSessionSchema, "POST", {
								cols: Math.max(2, Math.min(500, terminal.current?.cols ?? 80)),
								rows: Math.max(1, Math.min(200, terminal.current?.rows ?? 24)),
							});
							setSession(value);
							await attach(value);
						})
					}
				>
					Create shell
				</button>
				<button
					disabled={busy || !session}
					onClick={() =>
						void run(async () => {
							if (session) await attach(session);
						})
					}
				>
					Reconnect
				</button>
				<button
					disabled={busy || !session || session.status === "closed"}
					onClick={() =>
						void run(async () => {
							if (!session) return;
							setSession(await api.read(`terminals/${session.id}`, terminalSessionSchema, "DELETE"));
							socket.current?.close();
						})
					}
				>
					Close shell
				</button>
				<button
					disabled={busy}
					onClick={() =>
						void run(async () => {
							const value = await api.read(`workspaces/${id}/terminal`, terminalStatusSchema);
							setSession(value.session);
						})
					}
				>
					Refresh shell status
				</button>
			</div>
			<p>Disconnecting leaves the shell running. Lost/exited shells require explicit creation of a new shell.</p>
		</section>
	);
};
