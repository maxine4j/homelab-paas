import type { UiService } from "@homelab-paas/shared-contracts";
import { expect, test, vi } from "vitest";

import { InMemoryKeyValueStore } from "../store/in-memory-store.ts";
import { HealthHistoryService } from "./health-history-service.ts";
import { HealthHistoryStore } from "./health-history-store.ts";

const snapshot = (): UiService => ({
	serviceId: "demo",
	health: "Healthy",
	sync: "Synced",
	source: {},
	descriptorStatus: "available",
	resources: [{ resourceId: "service", type: "web", health: "Degraded", sync: "Synced", containers: [] }],
});

test("tracks aggregate and resource health separately without mutating inspection snapshots", async () => {
	const backing = new InMemoryKeyValueStore<unknown>();
	const store = new HealthHistoryStore(backing);
	let at = 100;
	const history = new HealthHistoryService(store, () => at);
	const original = snapshot();
	await history.observe(original);
	at = 200;
	const result = await history.observe(original);
	expect(result.healthTimeline).toEqual({ observedAt: 200, periods: [{ start: 100, end: 200, health: "Healthy" }] });
	expect(result.resources.at(0)?.healthTimeline?.periods.at(0)?.health).toBe("Degraded");
	expect(original.healthTimeline).toBeUndefined();
	at = 300;
	const restarted = await new HealthHistoryService(store, () => at).observe(original);
	expect(restarted.healthTimeline?.periods).toHaveLength(2);
	expect(restarted.healthTimeline?.periods.at(0)?.end).toBe(200);
});

test("history failures preserve status without falsely showing complete history, and retry next observation", async () => {
	const store = new HealthHistoryStore(new InMemoryKeyValueStore<unknown>());
	vi.spyOn(store, "record").mockRejectedValueOnce(new Error("disk unavailable"));
	const history = new HealthHistoryService(store, () => 100);
	expect(await history.observe(snapshot())).toEqual(snapshot());
	expect((await history.observe(snapshot())).healthTimeline?.observedAt).toBe(100);
});

test("a failed history write retains recorded service and resource coverage without extending it", async () => {
	const store = new HealthHistoryStore(new InMemoryKeyValueStore<unknown>());
	let at = 100;
	const history = new HealthHistoryService(store, () => at);
	await history.observe(snapshot());
	at = 200;
	const recorded = await history.observe(snapshot());
	vi.spyOn(store, "record").mockRejectedValueOnce(new Error("ENOSPC: no space left on device"));
	at = 300;
	const current = { ...snapshot(), sync: "OutOfSync" as const, retryAt: 1000 };
	const failed = await history.observe(current);
	expect(failed).toMatchObject({ health: "Healthy", sync: "OutOfSync", retryAt: 1000 });
	expect(failed.healthTimeline).toEqual(recorded.healthTimeline);
	expect(failed.resources.at(0)?.healthTimeline).toEqual(recorded.resources.at(0)?.healthTimeline);
	expect(current.healthTimeline).toBeUndefined();
	at = 400;
	const recovered = await history.observe(current);
	expect(recovered.healthTimeline?.periods).toEqual([
		{ start: 100, end: 200, health: "Healthy" },
		{ start: 400, end: 400, health: "Healthy" },
	]);
});

test("an interrupted inspection leaves a gap even when the next observation arrives promptly", async () => {
	let at = 100;
	const history = new HealthHistoryService(new HealthHistoryStore(new InMemoryKeyValueStore<unknown>()), () => at);
	await history.observe(snapshot());
	history.interrupt("demo");
	at = 200;
	const result = await history.observe(snapshot());
	expect(result.healthTimeline?.periods).toEqual([
		{ start: 100, end: 100, health: "Healthy" },
		{ start: 200, end: 200, health: "Healthy" },
	]);
});
