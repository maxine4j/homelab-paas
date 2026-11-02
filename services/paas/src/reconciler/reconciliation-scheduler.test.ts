import { expect, test, vi } from "vitest";

import { ChangeBus } from "../events/change-bus.ts";
import { createLogger } from "../util/logger.ts";
import { sleep, type ISleep } from "../util/sleep.ts";
import { testConfig } from "../util/test/config.ts";
import { ReconciliationScheduler } from "./reconciliation-scheduler.ts";
import type { ReconciliationState } from "./types.ts";

const fixture = () => {
	let now = 0;
	let checkpoint: ReconciliationState | undefined;
	const waits: { delay: number; signal?: AbortSignal; finish: () => void }[] = [];
	const sleep: ISleep = (delay, signal) =>
		new Promise<void>((resolve) => {
			waits.push({ delay, signal, finish: resolve });
			signal?.addEventListener("abort", () => resolve(), { once: true });
		});
	const reconcileOne = vi.fn(async (_id: string) => {});
	const redeploy = vi.fn(async (_id: string) => {});
	const pause = vi.fn(async (_id: string) => {});
	const resume = vi.fn(async (_id: string) => {});
	const refresh = vi.fn(async (_id: string) => false);
	const invalidate = vi.fn();
	const state = { read: vi.fn(async () => checkpoint), write: async () => {} };
	const changes = new ChangeBus();
	let taskId = 0;
	const scheduler = new ReconciliationScheduler(
		testConfig({ services: { demo: { remote: "repo", descriptorPath: "demo.yaml" } } }),
		{ reconcileOne, redeploy },
		state,
		{ refresh, invalidate },
		sleep,
		() => now,
		() => `run-${++taskId}`,
		changes,
		{ pause, resume },
	);
	return {
		scheduler,
		reconcileOne,
		redeploy,
		pause,
		resume,
		refresh,
		invalidate,
		state,
		changes,
		waits,
		checkpoint(value: ReconciliationState | undefined) {
			checkpoint = value;
		},
		advance(value: number) {
			now += value;
		},
	};
};

test("manual pause recovers shutdown retry deadlines and resume clears obsolete deployment backoff", async () => {
	const f = fixture();
	f.checkpoint({ phase: "failed", retryAt: 99999 });
	await f.scheduler.start();
	f.pause.mockImplementation(async () => {
		f.checkpoint({ phase: "ready", paused: true, retryAt: 1000 });
		throw new Error("shutdown failed");
	});
	await expect(f.scheduler.pause("demo")).rejects.toThrow("shutdown failed");
	await f.scheduler.settle();
	expect(f.waits.at(-1)?.delay).toBe(1000);
	f.resume.mockImplementation(async () => {
		f.checkpoint({ phase: "ready" });
	});
	await f.scheduler.resume("demo");
	f.scheduler.invalidate("demo");
	await f.scheduler.settle();
	expect(f.reconcileOne).toHaveBeenCalledWith("demo");
	await f.scheduler.stop();
	await expect(f.scheduler.resume("demo")).rejects.toMatchObject({ kind: "unavailable" });
});

test("shutdown settles an accepted manual lifecycle operation", async () => {
	const f = fixture();
	let finish = () => {};
	f.pause.mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	await f.scheduler.start();
	const pausing = f.scheduler.pause("demo");
	await vi.waitFor(() => expect(f.pause).toHaveBeenCalledOnce());
	let stopped = false;
	const stopping = f.scheduler.stop().then(() => {
		stopped = true;
	});
	await sleep(0);
	expect(stopped).toBe(false);
	finish();
	await Promise.all([pausing, stopping]);
	expect(stopped).toBe(true);
});

test("failed manual shutdown retains a bounded retry when its deadline could not be persisted", async () => {
	const f = fixture();
	f.checkpoint({ phase: "ready", paused: true });
	f.pause.mockRejectedValueOnce(new Error("checkpoint write failed"));
	await f.scheduler.start();
	await expect(f.scheduler.pause("demo")).rejects.toThrow("checkpoint write failed");
	await f.scheduler.settle();
	expect(f.waits.at(-1)?.delay).toBe(1000);
	await f.scheduler.stop();
});

test("each targeted execution establishes fresh task tracing without leaking context", async () => {
	const f = fixture();
	const lines: string[] = [];
	const log = createLogger("nested-reconciler", { write: (line: string) => lines.push(line) });
	f.reconcileOne.mockImplementation(async () => {
		log.info("drift");
	});
	await f.scheduler.start();
	for (let i = 0; i < 2; i++) {
		f.scheduler.invalidate("demo");
		await f.scheduler.settle();
	}
	log.info("outside");
	expect(
		lines.map((line) => {
			const { task, taskId } = JSON.parse(line);
			return [task, taskId];
		}),
	).toEqual([
		["reconciliation", "run-1"],
		["reconciliation", "run-2"],
		[undefined, undefined],
	]);
	await f.scheduler.stop();
});

test("initialization retains accepted input notifications before the execution gate opens", async () => {
	const f = fixture();
	f.scheduler.initialize();
	f.refresh.mockResolvedValue(true);
	f.changes.publish({ serviceId: "demo", desiredInputs: true });
	await f.scheduler.settle();
	expect(f.refresh).toHaveBeenCalledWith("demo");
	expect(f.reconcileOne).not.toHaveBeenCalled();
	await f.scheduler.start();
	await f.scheduler.settle();
	expect(f.reconcileOne).toHaveBeenCalledTimes(1);
	await f.scheduler.stop();
});

test("reconstructs retry deadlines without waking healthy services and retains backoff on hints", async () => {
	const f = fixture();
	f.checkpoint({ phase: "failed", failures: 3, retryAt: 4000 });
	await f.scheduler.start();
	await f.scheduler.settle();
	expect(f.waits.at(-1)?.delay).toBe(4000);
	expect(f.reconcileOne).not.toHaveBeenCalled();
	f.scheduler.invalidate("demo");
	await f.scheduler.settle();
	expect(f.waits.at(-1)?.delay).toBe(4000);
	f.reconcileOne.mockImplementation(async () => {
		f.checkpoint(undefined);
	});
	f.advance(4000);
	f.waits.at(-1)!.finish();
	await vi.waitFor(() => expect(f.reconcileOne).toHaveBeenCalledTimes(1));
	await f.scheduler.settle();
	const count = f.waits.length;
	f.advance(100000);
	expect(f.waits).toHaveLength(count);
	await f.scheduler.stop();
});

test("checkpoint write uncertainty retries after backoff even when the previous checkpoint was ready", async () => {
	const f = fixture();
	f.checkpoint({ phase: "ready" });
	f.reconcileOne.mockRejectedValueOnce(new Error("checkpoint write failed"));
	await f.scheduler.start();
	f.scheduler.invalidate("demo");
	await f.scheduler.settle();
	expect(f.waits.at(-1)?.delay).toBe(1000);
	f.advance(1000);
	f.waits.at(-1)!.finish();
	await vi.waitFor(() => expect(f.reconcileOne).toHaveBeenCalledTimes(2));
	await f.scheduler.stop();
});

test("manual redeploy uses the serialized forced path and settles errors while stopping", async () => {
	const f = fixture();
	f.checkpoint({ phase: "failed", retryAt: 9999 });
	await f.scheduler.start();
	await f.scheduler.redeploy("demo");
	expect(f.redeploy).toHaveBeenCalledWith("demo");
	expect(f.reconcileOne).not.toHaveBeenCalled();
	await expect(f.scheduler.redeploy("unknown")).rejects.toMatchObject({ kind: "not-found" });
	f.redeploy.mockRejectedValueOnce(new Error("rollout failed"));
	await expect(f.scheduler.redeploy("demo")).rejects.toThrow("rollout failed");
	await f.scheduler.stop();
	expect(f.waits.every((wait) => wait.signal?.aborted)).toBe(true);
	await expect(f.scheduler.redeploy("demo")).rejects.toMatchObject({ kind: "unavailable" });
});

test("only desired notifications schedule inputs; observation notifications cannot form a loop", async () => {
	const f = fixture();
	await f.scheduler.start();
	f.changes.publish({ serviceId: "demo" });
	f.changes.publish({});
	await f.scheduler.settle();
	expect(f.refresh).not.toHaveBeenCalled();
	f.refresh.mockResolvedValue(true);
	f.changes.publish({ serviceId: "demo", desiredInputs: true });
	await vi.waitFor(() => expect(f.reconcileOne).toHaveBeenCalledTimes(1));
	f.refresh.mockResolvedValue(false);
	await f.scheduler.refreshInputs("demo");
	await f.scheduler.settle();
	expect(f.reconcileOne).toHaveBeenCalledTimes(1);
	await f.scheduler.stop();
	f.changes.publish({ desiredInputs: true });
	expect(f.refresh).toHaveBeenCalledTimes(2);
});

test("shutdown waits for the active rollout and discards subsequent hints", async () => {
	const f = fixture();
	let release = () => {};
	f.reconcileOne.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
			}),
	);
	await f.scheduler.start();
	f.scheduler.invalidate("demo");
	await vi.waitFor(() => expect(f.reconcileOne).toHaveBeenCalledTimes(1));
	f.scheduler.invalidate("demo");
	let stopped = false;
	const stopping = f.scheduler.stop().then(() => {
		stopped = true;
	});
	await Promise.resolve();
	expect(stopped).toBe(false);
	release();
	await stopping;
	expect(f.reconcileOne).toHaveBeenCalledTimes(1);
});

test("desired refresh bursts coalesce and shutdown settles an accepted input read", async () => {
	const f = fixture();
	let release = () => {};
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	f.refresh.mockImplementationOnce(async () => {
		await blocked;
		return true;
	});
	await f.scheduler.start();
	const first = f.scheduler.refreshInputs("demo");
	for (let i = 0; i < 100; i++) void f.scheduler.refreshInputs("demo");
	expect(f.refresh).toHaveBeenCalledTimes(1);
	let stopped = false;
	const stopping = f.scheduler.stop().then(() => {
		stopped = true;
	});
	await Promise.resolve();
	expect(stopped).toBe(false);
	release();
	await Promise.all([first, stopping]);
	expect(f.refresh).toHaveBeenCalledTimes(1);
	expect(f.reconcileOne).not.toHaveBeenCalled();
});

test("coalesces a bounded service queue and retains invalidation during work", async () => {
	let release = () => {};
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	const reconcileOne = vi.fn(async (_id: string) => {});
	reconcileOne.mockImplementationOnce(async () => blocked);
	const scheduler = new ReconciliationScheduler(
		testConfig({
			services: {
				a: { remote: "repo", descriptorPath: "a.yaml" },
				b: { remote: "repo", descriptorPath: "b.yaml" },
			},
		}),
		{ reconcileOne, redeploy: vi.fn(async () => {}) },
		{ read: async () => undefined, write: async () => {} },
		{ refresh: async () => false, invalidate: () => {} },
		async () => {},
		() => 0,
		() => "run",
	);
	for (let i = 0; i < 100; i++) scheduler.invalidate("a");
	expect(reconcileOne).not.toHaveBeenCalled();
	await scheduler.start();
	await vi.waitFor(() => expect(reconcileOne).toHaveBeenCalledTimes(1));
	for (let i = 0; i < 100; i++) scheduler.invalidate("a");
	scheduler.invalidate("b");
	scheduler.invalidate("unknown");
	release();
	await scheduler.settle();
	expect(reconcileOne.mock.calls.map(([id]) => id)).toEqual(["a", "a", "b"]);
	await scheduler.stop();
});
