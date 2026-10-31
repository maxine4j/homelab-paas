import { expect, test, vi } from "vitest";

import { ChangeBus } from "../events/change-bus.ts";
import { sleep } from "../util/sleep.ts";
import type { IPaasUiService } from "./paas-ui-service.ts";
import { UiLiveService } from "./ui-live-service.ts";

test("cluster logs stream independently and restart only for cluster configuration changes", async () => {
	const changes = new ChangeBus();
	const streams: {
		signal: AbortSignal;
		receive: (logs: { containerId: string; content: string; tail: 200 }) => void;
	}[] = [];
	const live = new UiLiveService(
		{} as IPaasUiService,
		{
			followLogs: async () => {},
			followControlPlaneLogs: async (receive, signal) => {
				streams.push({ receive, signal });
				receive({ containerId: "control", content: "ready", tail: 200 });
			},
		},
		changes,
	);
	const receive = vi.fn();
	const stop = live.subscribe("control", { kind: "cluster-logs" }, receive);
	expect(receive).toHaveBeenCalledWith({
		type: "snapshot",
		id: "control",
		target: { kind: "cluster-logs" },
		data: { containerId: "control", content: "ready", tail: 200 },
	});
	changes.publish({ serviceId: "demo", refreshLogs: true });
	expect(streams).toHaveLength(1);
	changes.publish({});
	expect(streams).toHaveLength(2);
	expect(streams[0]?.signal.aborted).toBe(true);
	const count = receive.mock.calls.length;
	streams[0]?.receive({ containerId: "control", content: "stale", tail: 200 });
	expect(receive).toHaveBeenCalledTimes(count);
	stop();
	expect(streams[1]?.signal.aborted).toBe(true);
});

test("subscribes with initial snapshots, coalesces invalidations and cancels stale delivery", async () => {
	const changes = new ChangeBus();
	let finish: (value: never[]) => void = () => {};
	const listServices = vi.fn(
		() =>
			new Promise<never[]>((resolve) => {
				finish = resolve;
			}),
	);
	const ui = { listServices } as unknown as IPaasUiService;
	const live = new UiLiveService(ui, { followLogs: async () => {}, followControlPlaneLogs: async () => {} }, changes);
	const receive = vi.fn();
	const stop = live.subscribe("1", { kind: "services" }, receive);
	changes.publish({ serviceId: "demo" });
	changes.publish({ serviceId: "demo" });
	expect(listServices).toHaveBeenCalledTimes(1);
	finish([]);
	await sleep(0);
	expect(receive).toHaveBeenCalledWith({ type: "snapshot", id: "1", target: { kind: "services" }, data: [] });
	expect(listServices).toHaveBeenCalledTimes(2);
	stop();
	finish([]);
	await sleep(0);
	expect(receive).toHaveBeenCalledTimes(1);
});

test("log cancellation aborts actual stream and failures never serialize raw causes", async () => {
	let signal: AbortSignal | undefined;
	const changes = new ChangeBus();
	const live = new UiLiveService(
		{} as IPaasUiService,
		{
			followControlPlaneLogs: async () => {},
			followLogs: async (_service, _resource, _container, receive, passed) => {
				signal = passed;
				receive({ containerId: "c", content: "safe", tail: 200 });
				throw new Error("private error payload");
			},
		},
		changes,
	);
	const receive = vi.fn();
	const stop = live.subscribe("1", { kind: "logs", serviceId: "demo", resourceId: "app", containerId: "c" }, receive);
	await sleep(0);
	expect(JSON.stringify(receive.mock.calls)).not.toContain("private");
	expect(receive.mock.calls.at(-1)?.[0]).toMatchObject({
		type: "error",
		message: "Cluster data is unavailable; retry shortly",
	});
	stop();
	expect(signal?.aborted).toBe(true);
});

test("config/source changes replace log streams while health invalidations preserve the follow", () => {
	const changes = new ChangeBus();
	const streams: {
		signal: AbortSignal;
		receive: (logs: { containerId: string; content: string; tail: 200 }) => void;
	}[] = [];
	const live = new UiLiveService(
		{} as IPaasUiService,
		{
			followControlPlaneLogs: async () => {},
			followLogs: async (_service, _resource, _container, receive, signal) => {
				streams.push({ signal, receive });
			},
		},
		changes,
	);
	const receive = vi.fn();
	const stop = live.subscribe("1", { kind: "logs", serviceId: "demo", resourceId: "app", containerId: "c" }, receive);
	changes.publish({ serviceId: "demo" });
	expect(streams).toHaveLength(1);
	changes.publish({ serviceId: "demo", refreshLogs: true });
	expect(streams).toHaveLength(2);
	expect(streams[0]?.signal.aborted).toBe(true);
	streams[0]?.receive({ containerId: "c", content: "stale", tail: 200 });
	expect(receive).not.toHaveBeenCalled();
	changes.publish({});
	expect(streams).toHaveLength(3);
	stop();
	expect(streams.every((stream) => stream.signal.aborted)).toBe(true);
});
