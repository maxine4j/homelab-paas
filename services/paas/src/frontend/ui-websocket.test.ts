import { once } from "node:events";
import { createServer } from "node:http";

import { expect, test, vi } from "vitest";
import { WebSocket } from "ws";

import { sleep } from "../util/sleep.ts";
import { UiWebSocket } from "./ui-websocket.ts";

test("upgrade protects origin/session, pushes initial subscriptions, closes malformed messages and cleans up", async () => {
	const server = createServer();
	const stopped = vi.fn();
	const subscribe = vi.fn((_id, _target, receive) => {
		receive({ type: "snapshot", id: "1", target: { kind: "services" }, data: [] });
		return stopped;
	});
	let authenticated = true;
	let tick: (() => void) | undefined;
	const pause = vi.fn(
		(_ms: number, signal?: AbortSignal) =>
			new Promise<void>((resolve, reject) => {
				tick = resolve;
				signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
			}),
	);
	const adapter = new UiWebSocket(
		{ subscribe },
		() => "http://management.test",
		{
			verifyAuthCookie: (token) =>
				authenticated && token === "valid" ? { userId: "1", username: "Alice" } : undefined,
		},
		pause,
	);
	adapter.attach(server);
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing address");
	const url = `ws://127.0.0.1:${address.port}/api/ui/live`;
	const sockets: WebSocket[] = [];
	try {
		for (const headers of [
			{ origin: "http://evil.test", cookie: "__Secure-paas_session=valid" },
			{ origin: "http://management.test", cookie: "__Secure-paas_session=valid; __Secure-paas_session=valid" },
		]) {
			const socket = new WebSocket(url, { headers });
			sockets.push(socket);
			await expect(once(socket, "open")).rejects.toThrow("403");
		}
		const socket = new WebSocket(url, {
			headers: { origin: "http://management.test", cookie: "__Secure-paas_session=valid" },
		});
		sockets.push(socket);
		await once(socket, "open");
		const message = once(socket, "message");
		socket.send(JSON.stringify({ type: "subscribe", id: "1", target: { kind: "services" } }));
		expect(JSON.parse(String((await message)[0]))).toMatchObject({ type: "snapshot", data: [] });
		authenticated = false;
		const closed = once(socket, "close");
		tick?.();
		expect((await closed)[0]).toBe(1008);
		expect(stopped).toHaveBeenCalledTimes(1);
		authenticated = true;
		const malformed = new WebSocket(url, {
			headers: { origin: "http://management.test", cookie: "__Secure-paas_session=valid" },
		});
		sockets.push(malformed);
		await once(malformed, "open");
		const malformedClosed = once(malformed, "close");
		malformed.send('{"type":"subscribe","id":"1","target":{"kind":"secrets"}}');
		expect((await malformedClosed)[0]).toBe(1008);
	} finally {
		for (const socket of sockets) socket.terminate();
		await adapter.close();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});

test("adapter permits unauthenticated local management with the same origin guard", async () => {
	const adapter = new UiWebSocket({ subscribe: () => () => {} }, () => "http://local.test", undefined, sleep);
	await adapter.close();
});

test("large diagnostic histories are delivered while oversized input/output and excessive subscriptions close", async () => {
	const server = createServer();
	let large = false;
	let history = false;
	const adapter = new UiWebSocket(
		{
			subscribe: (id, target, receive) => {
				if (history)
					receive({
						type: "snapshot",
						id,
						target,
						data: Array.from({ length: 200 }, (_, timestamp) => ({
							timestamp,
							level: "error",
							event: "reconciliation.failed",
							message: "Failed",
							diagnostics: "x".repeat(32766),
						})),
					});
				if (large)
					receive({
						type: "snapshot",
						id,
						target,
						data: { clusterId: "test", config: "x".repeat(16777217), revision: "r", fields: [] },
					});
				return () => {};
			},
		},
		() => "http://local.test",
		undefined,
		sleep,
	);
	adapter.attach(server);
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing address");
	const connect = async () => {
		const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/ui/live`, { origin: "http://local.test" });
		await once(socket, "open");
		return socket;
	};
	try {
		const oversized = await connect();
		const oversizedClosed = once(oversized, "close");
		oversized.send("x".repeat(8193));
		expect((await oversizedClosed)[0]).toBe(1009);
		const excessive = await connect();
		const excessiveClosed = once(excessive, "close");
		for (let index = 0; index < 17; index++)
			excessive.send(JSON.stringify({ type: "subscribe", id: String(index), target: { kind: "services" } }));
		expect((await excessiveClosed)[0]).toBe(1008);
		history = true;
		const reader = await connect();
		const received = Promise.race([
			once(reader, "message").then(([value]) => JSON.parse(String(value))),
			once(reader, "close").then(() => undefined),
		]);
		reader.send(JSON.stringify({ type: "subscribe", id: "events", target: { kind: "events", serviceId: "demo" } }));
		expect((await received)?.data).toHaveLength(200);
		reader.terminate();
		history = false;
		large = true;
		const slow = await connect();
		const slowClosed = once(slow, "close");
		slow.send(JSON.stringify({ type: "subscribe", id: "large", target: { kind: "cluster" } }));
		expect((await slowClosed)[0]).toBe(1009);
	} finally {
		await adapter.close();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
