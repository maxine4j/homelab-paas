import type { UiServiceEvent } from "@homelab-paas/shared-contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

import { subscribeUi, type BrowserSocket } from "./live.ts";
import { ResourceEventsPage } from "./pages/resource-events-page.tsx";
import { ResourcePage } from "./pages/resource-page.tsx";

test.each(["/cluster", "/services", "/services/demo", "/services/demo/resources/app", "/services/demo/events"])(
	"%s requests its initial snapshot as soon as the socket opens",
	(path) => {
		vi.useFakeTimers();
		try {
			const socket: BrowserSocket = {
				onopen: null,
				onclose: null,
				onerror: null,
				onmessage: null,
				send: vi.fn(),
				close: vi.fn(),
			};
			const create = vi.fn(() => socket);
			const stop = subscribeUi(path, () => {}, create, "https://cluster.test");
			expect(create).toHaveBeenCalledExactlyOnceWith("wss://cluster.test/api/ui/live");
			socket.onopen?.(new Event("open"));
			expect(socket.send).toHaveBeenCalledTimes(1);
			expect(JSON.parse(vi.mocked(socket.send).mock.calls.at(0)![0])).toMatchObject({ type: "subscribe" });
			expect(vi.getTimerCount()).toBe(0);
			stop();
		} finally {
			vi.useRealTimers();
		}
	},
);

test("resource views filter immediate and persisted service events identically across reconnect and navigation", async () => {
	vi.useFakeTimers();
	try {
		const sockets: BrowserSocket[] = [];
		const create = () => {
			const socket: BrowserSocket = {
				onopen: null,
				onclose: null,
				onmessage: null,
				onerror: null,
				send: vi.fn(),
				close: vi.fn(),
			};
			sockets.push(socket);
			return socket;
		};
		const update = vi.fn();
		const cancel = subscribeUi<UiServiceEvent[]>("/services/demo/events", update, create, "https://cluster.test");
		const event: UiServiceEvent = {
			timestamp: 1,
			event: "reconciliation.failed",
			level: "error",
			resourceId: "app",
			message: "Port bind failed",
			diagnostics: JSON.stringify({
				error: {
					message: "Port bind failed",
					stack: "Error: Port bind failed\n    at start (file:///app/services/paas/src/start.ts:1:2)",
					cause: { message: "Docker bind failed", status: 500 },
				},
				context: { image: "app:1" },
				contextYaml: "image: app:1\n",
			}),
		};
		const push = (value: unknown) =>
			sockets.at(-1)!.onmessage?.(new MessageEvent("message", { data: JSON.stringify(value) }));
		push({ type: "event", serviceId: "other", event: { ...event, message: "Wrong service" } });
		push({ type: "event", serviceId: "demo", event });
		push({
			type: "event",
			serviceId: "demo",
			event: { ...event, message: "Wrong resource", resourceId: "app-other" },
		});
		push({ type: "event", serviceId: "demo", event: { ...event, message: "Service-wide", resourceId: undefined } });
		const render = () => {
			const events: UiServiceEvent[] = update.mock.calls.at(-1)![0].data;
			return [
				renderToStaticMarkup(
					createElement(ResourceEventsPage, { serviceId: "demo", resourceId: "app", events }),
				),
				renderToStaticMarkup(
					createElement(ResourcePage, {
						serviceId: "demo",
						resource: {
							resourceId: "app",
							type: "web",
							sync: "OutOfSync",
							health: "Degraded",
							containers: [],
						},
						tab: "config",
						events,
					}),
				),
			];
		};
		const immediate = render();
		for (const html of immediate) {
			expect(html.match(/class="service-event service-event-error"/g)).toHaveLength(1);
			expect(html).toContain("Port bind failed");
			expect(html).toContain("\n    at start (src/start.ts:1:2)");
			expect(html).toContain("image: app:1\n");
			for (const excluded of ["Wrong service", "Wrong resource", "Service-wide"])
				expect(html).not.toContain(excluded);
		}
		sockets.at(-1)!.onclose?.({} as CloseEvent);
		await vi.advanceTimersByTimeAsync(1000);
		push({ type: "snapshot", id: "view", target: { kind: "events", serviceId: "demo" }, data: [event] });
		expect(render()).toEqual(immediate);
		cancel();
		const count = update.mock.calls.length;
		push({ type: "event", serviceId: "demo", event: { ...event, message: "Stale" } });
		expect(update).toHaveBeenCalledTimes(count);
	} finally {
		vi.useRealTimers();
	}
});

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
