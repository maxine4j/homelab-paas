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

test("rejects invalid persisted events, unsafe messages and service identities", async () => {
	const backing = new InMemoryKeyValueStore<unknown>();
	const store = new ServiceEventStore(backing);
	await expect(store.append("demo", { ...event(1), message: "raw-secret" })).rejects.toThrow(
		"Cannot append service event",
	);
	await expect(store.list("../demo")).rejects.toThrow("Invalid service event identity");
	await backing.set("demo.events", [{ ...event(1), message: "raw-secret" }]);
	await expect(store.list("demo")).rejects.toThrow("Cannot read service events");
});
