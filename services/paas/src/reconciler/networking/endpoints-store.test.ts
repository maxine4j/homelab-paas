import { expect, test } from "vitest";

import { InMemoryKeyValueStore } from "../../store/in-memory-store.ts";
import { ReconciliationStore } from "../reconciliation-store.ts";
import { EndpointsStore } from "./endpoints-store.ts";

const endpoint = { address: "10.0.0.2", port: 80, public: true };
test("paused routes are hidden from every reader across restart, and service withdrawal removes all routes", async () => {
	const values = new InMemoryKeyValueStore<unknown>();
	const state = new ReconciliationStore(values);
	const services = async () => ["demo", "other"];
	const store = new EndpointsStore(values, services, state);
	await store.set("web.demo", endpoint);
	await store.set("site.demo", { ...endpoint, static: true, primary: true });
	await store.set("web.other", endpoint);
	await state.write("demo", { phase: "ready", paused: true });
	expect(await new EndpointsStore(values, services, state).getAll()).toEqual({ "web.other": endpoint });
	await store.set("demo", undefined);
	await state.write("demo", { phase: "ready", paused: false });
	expect(await store.getAll()).toEqual({ "web.other": endpoint });
	expect(await values.get("demo.routes")).toEqual({});
});
test("writes only the affected service and restores a complete snapshot including removed services", async () => {
	const values = new InMemoryKeyValueStore<unknown>();
	const services = async () => ["demo", "gone"];
	const store = new EndpointsStore(values, services);
	await store.set("web.demo", endpoint);
	await store.set("web.gone", endpoint);
	expect(await values.get("demo.routes")).toEqual({ "web.demo": endpoint });
	expect(await values.get("gone.routes")).toEqual({ "web.gone": endpoint });
	expect(await values.get("routes")).toBeUndefined();
	expect(await new EndpointsStore(values, services).getAll()).toEqual({ "web.demo": endpoint, "web.gone": endpoint });
	await store.set("web.demo", undefined);
	expect(await store.getAll()).toEqual({ "web.gone": endpoint });
});
test("rejects routes belonging to another service and unreadable files instead of publishing partial state", async () => {
	const values = new InMemoryKeyValueStore<unknown>();
	const store = new EndpointsStore(values, async () => ["demo", "other"]);
	await values.set("demo.routes", { "web.other": endpoint });
	await expect(store.getAll()).rejects.toThrow("Cannot read reconciliation data");
	await values.set("demo.routes", {});
	await values.set("other.routes", null);
	await expect(store.getAll()).rejects.toThrow("Cannot read reconciliation data");
	const failure = new Error("unreadable route file");
	const unreadable = new EndpointsStore(
		{
			get: async (key) => {
				if (key === "other.routes") throw failure;
				return { "web.demo": endpoint };
			},
			set: async () => {},
			update: async () => {},
			delete: async () => {},
		},
		async () => ["demo", "other"],
	);
	await expect(unreadable.getAll()).rejects.toMatchObject({ cause: failure });
});
