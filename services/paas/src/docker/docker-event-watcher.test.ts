import { expect, test, vi } from "vitest";

import { testConfig } from "../util/test/config.ts";
import { DockerEventWatcher } from "./docker-event-watcher.ts";
import type { DockerEvent } from "./types.ts";

const fixture = () => {
	let deliver: ((event: DockerEvent | undefined) => void) | undefined;
	let signal: AbortSignal;
	const subscribe = vi.fn(async (value: AbortSignal) => {
		signal = value;
		return (async function* () {
			while (!value.aborted) {
				const event = await new Promise<DockerEvent | undefined>((resolve) => {
					deliver = resolve;
					value.addEventListener("abort", () => resolve(undefined), { once: true });
				});
				if (!event) return;
				yield event;
			}
		})();
	});
	const invalidate = vi.fn();
	const invalidateHealth = vi.fn();
	const refresh = vi.fn(async () => {});
	const audit = vi.fn(async () => {});
	const waits: { finish: () => void; ms: number }[] = [];
	const inspectNetwork = vi.fn(async (_id: string) => null);
	const watcher = new DockerEventWatcher(
		{ subscribe },
		{ inspectNetwork, inspectContainer: async () => null },
		testConfig({
			metadata: { clusterId: "test" },
			services: {
				demo: { remote: "repo", descriptorPath: "sd.yaml" },
				other: { remote: "repo", descriptorPath: "sd.yaml" },
			},
		}),
		{ invalidate },
		{ invalidateService: invalidateHealth },
		{ refresh },
		{ run: audit },
		(ms, abort) =>
			new Promise<void>((resolve) => {
				waits.push({ ms, finish: resolve });
				abort?.addEventListener("abort", () => resolve(), { once: true });
			}),
		() => "task-id",
	);
	return {
		watcher,
		subscribe,
		invalidate,
		invalidateHealth,
		refresh,
		audit,
		waits,
		inspectNetwork,
		async emit(event: DockerEvent) {
			await vi.waitFor(() => expect(deliver).toBeDefined());
			const send = deliver!;
			deliver = undefined;
			send(event);
			await vi.waitFor(() => expect(deliver).toBeDefined());
		},
		end() {
			deliver?.(undefined);
		},
		get signal() {
			return signal;
		},
	};
};

const hint = (attributes: Record<string, string>, action = "die"): DockerEvent => ({
	type: "container",
	action,
	id: "id",
	attributes,
});

test("consumes lifecycle hints while refresh/audit is blocked; filters foreign labels and health-only hints", async () => {
	const f = fixture();
	let release!: () => void;
	f.refresh.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
			}),
	);
	await f.watcher.start();
	const own = { "homelab-paas.cluster": "test", "homelab-paas.service": "demo" };
	await f.emit(hint(own));
	await f.emit(hint(own, "update"));
	await f.emit(hint({ ...own, "homelab-paas.cluster": "foreign" }));
	await f.emit(hint(own, "health_status: unhealthy"));
	expect(f.invalidate).toHaveBeenCalledTimes(2);
	expect(f.invalidateHealth).toHaveBeenCalledTimes(3);
	release();
	await f.watcher.stop();
	expect(f.signal.aborted).toBe(true);
});

test("reconnect audit does not block event consumption and cancellation interrupts backoff", async () => {
	const f = fixture();
	let release!: () => void;
	f.audit.mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
			}),
	);
	await f.watcher.start();
	f.end();
	await vi.waitFor(() => expect(f.waits).toHaveLength(1));
	expect(f.waits[0]?.ms).toBe(1000);
	f.waits[0]!.finish();
	await vi.waitFor(() => expect(f.audit).toHaveBeenCalledTimes(1));
	await f.emit(hint({ "homelab-paas.cluster": "test", "homelab-paas.role": "envoy" }));
	expect(f.invalidate.mock.calls.map(([id]) => id)).toEqual(["demo", "other"]);
	release();
	f.end();
	await vi.waitFor(() => expect(f.waits).toHaveLength(2));
	await f.watcher.stop();
});

test("network mapping is verified by labels, with remembered destroy identity and conservative unknown audit", async () => {
	const f = fixture();
	await f.watcher.start();
	f.watcher.rememberNetwork("owned", "demo");
	await f.emit({ type: "network", action: "destroy", id: "owned", attributes: { name: "untrusted" } });
	await vi.waitFor(() => expect(f.invalidate).toHaveBeenCalledWith("demo"));
	await f.emit({ type: "network", action: "disconnect", id: "unknown", attributes: {} });
	await vi.waitFor(() => expect(f.audit).toHaveBeenCalled());
	await f.watcher.stop();
});

test("coalesces unknown event audits while retaining a subsequent scan after a failed active scan", async () => {
	const f = fixture();
	let fail!: (error: Error) => void;
	f.audit.mockImplementationOnce(
		() =>
			new Promise<void>((_resolve, reject) => {
				fail = reject;
			}),
	);
	await f.watcher.start();
	for (let index = 0; index < 5; index++) await f.emit(hint({ "homelab-paas.cluster": "test" }));
	expect(f.audit).toHaveBeenCalledTimes(1);
	fail(new Error("audit unavailable"));
	await vi.waitFor(() => expect(f.audit).toHaveBeenCalledTimes(2));
	await f.watcher.stop();
});

test("cancels a subscription awaiting headers without leaving startup pending", async () => {
	const config = testConfig();
	const watcher = new DockerEventWatcher(
		{
			subscribe: (signal) =>
				new Promise((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
				}),
		},
		{ inspectNetwork: async () => null, inspectContainer: async () => null },
		config,
		{ invalidate: () => {} },
		{ invalidateService: () => {} },
		{ refresh: async () => {} },
		{ run: async () => {} },
		async () => {},
		() => "task",
	);
	const starting = expect(watcher.start()).rejects.toThrow("stopped before connection");
	await watcher.stop();
	await starting;
});
