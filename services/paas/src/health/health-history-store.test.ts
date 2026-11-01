import { expect, test } from "vitest";

import { InMemoryKeyValueStore } from "../store/in-memory-store.ts";
import { HealthHistoryStore } from "./health-history-store.ts";

test("persists isolated service/resource histories and merges consecutive health observations", async () => {
	const backing = new InMemoryKeyValueStore<unknown>();
	const store = new HealthHistoryStore(backing);
	await store.record("demo", { service: "Healthy", app: "Healthy" }, 100, false);
	await store.record("demo", { service: "Healthy", app: "Healthy" }, 200, false);
	await store.record("demo", { service: "Progressing", app: "Progressing" }, 210, false);
	await store.record("demo", { service: "Healthy", app: "Healthy" }, 220, false);
	const history = await new HealthHistoryStore(backing).read("demo");
	expect(history["app"]).toEqual({
		observedAt: 220,
		periods: [
			{ start: 100, end: 210, health: "Healthy" },
			{ start: 210, end: 220, health: "Progressing" },
			{ start: 220, end: 220, health: "Healthy" },
		],
	});
	expect(await store.read("other")).toEqual({});
});

test("leaves restart and long observation gaps unfilled and does not carry removed resources forward", async () => {
	const store = new HealthHistoryStore(new InMemoryKeyValueStore<unknown>());
	await store.record("demo", { service: "Healthy", app: "Healthy" }, 100, false);
	await store.record("demo", { service: "Healthy" }, 200, true);
	await store.record("demo", { service: "Healthy" }, 100_000, false);
	expect((await store.read("demo"))["service"]?.periods).toEqual([
		{ start: 100, end: 100, health: "Healthy" },
		{ start: 200, end: 200, health: "Healthy" },
		{ start: 100_000, end: 100_000, health: "Healthy" },
	]);
	expect((await store.read("demo"))["app"]).toBeUndefined();
});

test("bounds each series to 24 hours and 2000 periods and validates persisted data and identities", async () => {
	const backing = new InMemoryKeyValueStore<unknown>();
	const store = new HealthHistoryStore(backing);
	for (let i = 0; i < 2005; i++) await store.record("demo", { service: i % 2 ? "Healthy" : "Degraded" }, i, false);
	expect((await store.read("demo"))["service"]?.periods).toHaveLength(2000);
	await store.record("demo", { service: "Healthy" }, 86_500_000, false);
	expect((await store.read("demo"))["service"]?.periods).toHaveLength(1);
	await expect(store.read("../secret")).rejects.toThrow("Invalid health history identity");
	await backing.set("demo.health", {
		service: { observedAt: 1, periods: [{ start: 5, end: 1, health: "Healthy" }] },
	});
	await expect(store.read("demo")).rejects.toThrow("Cannot read health history");
});
