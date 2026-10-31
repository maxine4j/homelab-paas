import { expect, test } from "vitest";

import { FileSystemKeyValueStore } from "../store/file-system-store.ts";
import { InMemoryKeyValueStore } from "../store/in-memory-store.ts";
import { ServiceEventStore } from "./service-event-store.ts";

const event = (timestamp: number) => ({
	timestamp,
	level: "error" as const,
	event: "reconciliation.failed" as const,
	message: "Cannot resolve application secrets; check the service env file and required variable names",
	resourceId: "app",
	failures: 1,
	retryAt: timestamp + 1000,
});

test("persists service-scoped events across store recreation and returns newest first", async () => {
	const files = new Map<string, string>();
	const backing = new FileSystemKeyValueStore<unknown>(
		"/state",
		async (path) => files.get(path),
		async (path, data) => {
			files.set(path, data);
		},
		async (path) => {
			files.delete(path);
		},
		"yaml",
	);
	const store = new ServiceEventStore(backing);
	expect(await store.list("demo")).toEqual([]);
	await store.append("demo", event(1));
	await store.append("other", event(2));
	await store.append("demo", event(3));
	expect(await new ServiceEventStore(backing).list("demo")).toEqual([event(3), event(1)]);
	expect(files.has("/state/demo.events.yaml")).toBe(true);
});

test("serializes concurrent appends and retains only the latest 200 events", async () => {
	const store = new ServiceEventStore(new InMemoryKeyValueStore<unknown>());
	await Promise.all(Array.from({ length: 205 }, (_, index) => store.append("demo", event(index))));
	const events = await store.list("demo");
	expect(events).toHaveLength(200);
	expect(events.at(0)).toEqual(event(204));
	expect(events.at(-1)).toEqual(event(5));
});

test("persists specific sanitized summaries and rejects unbounded messages and service identities", async () => {
	const backing = new InMemoryKeyValueStore<unknown>();
	const store = new ServiceEventStore(backing);
	const specific = { ...event(1), message: "Worker readiness failed: container is not running" };
	await store.append("demo", specific);
	expect(await store.list("demo")).toEqual([specific]);
	await expect(store.append("demo", { ...event(1), message: "x".repeat(4097) })).rejects.toThrow(
		"Cannot append service event",
	);
	await expect(store.list("../demo")).rejects.toThrow("Invalid service event identity");
	await backing.set("demo.events", [{ ...event(1), message: "" }]);
	await expect(store.list("demo")).rejects.toThrow("Cannot read service events");
});

test("retains structured secret diagnostics with legacy events and rejects raw file content", async () => {
	const backing = new InMemoryKeyValueStore<unknown>();
	const store = new ServiceEventStore(backing);
	await store.append("demo", event(1));
	const detailed = {
		...event(2),
		secretFailure: {
			reason: "missing-variables" as const,
			filePath: "/etc/homelab-paas/env/demo.env",
			hostFilePath: "/srv/config/env/demo.env",
			missingVariables: ["TOKEN", "PASSWORD"],
		},
	};
	await store.append("demo", detailed);
	expect(await new ServiceEventStore(backing).list("demo")).toEqual([detailed, event(1)]);
	await backing.set("demo.events", [
		{ ...detailed, secretFailure: { ...detailed.secretFailure, content: "private-value" } },
	]);
	await expect(store.list("demo")).rejects.toThrow("Cannot read service events");
});

test("persists bounded redacted diagnostic text alongside legacy events", async () => {
	const store = new ServiceEventStore(new InMemoryKeyValueStore<unknown>());
	const detailed = { ...event(1), diagnostics: "Error: Docker HTTP 500: permission denied\n at deploy" };
	await store.append("demo", detailed);
	expect(await store.list("demo")).toEqual([detailed]);
	await expect(store.append("demo", { ...event(2), diagnostics: "x".repeat(32769) })).rejects.toThrow(
		"Cannot append service event",
	);
});
