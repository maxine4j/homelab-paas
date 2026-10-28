import { expect, test, vi } from "vitest";

import { subscribeUi, type BrowserSocket } from "./live.ts";

test("live subscription replaces snapshots, reconnects and cancels without HTTP polling", async () => {
	vi.useFakeTimers();
	try {
		const sockets: BrowserSocket[] = [];
		const sent: string[] = [];
		const create = vi.fn(() => {
			const socket: BrowserSocket = {
				onopen: null,
				onclose: null,
				onmessage: null,
				onerror: null,
				send: (text) => sent.push(text),
				close: vi.fn(),
			};
			sockets.push(socket);
			return socket;
		});
		const update = vi.fn();
		const cancel = subscribeUi(
			"/services/demo/resources/app/containers/c/logs",
			update,
			create,
			"https://cluster.test",
		);
		sockets[0]!.onopen?.(new Event("open"));
		expect(JSON.parse(sent[0]!)).toMatchObject({ type: "subscribe", target: { kind: "logs" } });
		const target = { kind: "logs", serviceId: "demo", resourceId: "app", containerId: "c" };
		const receive = (content: string) =>
			new MessageEvent("message", {
				data: JSON.stringify({
					type: "snapshot",
					id: "view",
					target,
					data: { containerId: "c", content, tail: 200 },
				}),
			});
		sockets[0]!.onmessage?.(receive("first\n"));
		expect(update).toHaveBeenLastCalledWith({
			data: { containerId: "c", content: "first\n", tail: 200 },
			connected: true,
		});
		sockets[0]!.onclose?.({} as CloseEvent);
		await vi.advanceTimersByTimeAsync(1000);
		sockets[1]!.onopen?.(new Event("open"));
		sockets[1]!.onmessage?.(receive("fresh\n"));
		expect(update).toHaveBeenLastCalledWith({
			data: { containerId: "c", content: "fresh\n", tail: 200 },
			connected: true,
		});
		cancel();
		const count = update.mock.calls.length;
		sockets[1]!.onmessage?.(receive("stale"));
		await vi.advanceTimersByTimeAsync(60000);
		expect(update).toHaveBeenCalledTimes(count);
		expect(create).toHaveBeenCalledTimes(2);
	} finally {
		vi.useRealTimers();
	}
});

test("immediate events survive stale history snapshots and deduplicate persisted events independent of object key order", () => {
	let socket: BrowserSocket = {
		onopen: null,
		onclose: null,
		onerror: null,
		onmessage: null,
		send: () => {},
		close: () => {},
	};
	const update = vi.fn();
	const cancel = subscribeUi("/services/demo/events", update, () => socket, "https://cluster.test");
	const event = {
		timestamp: 1,
		level: "info",
		event: "deployment.started",
		message: "Deployment started",
		revision: "rev",
	};
	const push = (value: unknown) => socket.onmessage?.(new MessageEvent("message", { data: JSON.stringify(value) }));
	push({ type: "event", serviceId: "demo", event });
	push({ type: "snapshot", id: "view", target: { kind: "events", serviceId: "demo" }, data: [] });
	expect(update.mock.calls.at(-1)?.[0].data).toHaveLength(1);
	push({
		type: "snapshot",
		id: "view",
		target: { kind: "events", serviceId: "demo" },
		data: [
			{
				revision: "rev",
				message: "Deployment started",
				event: "deployment.started",
				level: "info",
				timestamp: 1,
			},
		],
	});
	expect(update.mock.calls.at(-1)?.[0].data).toHaveLength(1);
	cancel();
});
