import type { UiService, UiServiceSummary, UiResource } from "@homelab-paas/shared-contracts";
import { expect, test, vi } from "vitest";

import { ChangeBus } from "../events/change-bus.ts";
import { testConfig } from "../util/test/config.ts";
import { CachedPaasUiService } from "./cached-paas-ui-service.ts";
import type { IPaasUiService } from "./paas-ui-service.ts";

const fixture = () => {
	const summary: UiServiceSummary = { serviceId: "demo", sync: "Synced", health: "Healthy" };
	const resource: UiResource = { resourceId: "app", type: "web", sync: "Synced", health: "Healthy", containers: [] };
	const snapshot: UiService = { ...summary, source: {}, descriptorStatus: "unavailable", resources: [resource] };
	const source = { remote: "https://example.test/repo", descriptorPath: "service.yaml" };
	const config = testConfig({ services: { demo: source } });
	const ui = {
		listServices: vi.fn(async () => [summary]),
		getService: vi.fn(async () => snapshot),
		getResource: vi.fn(async () => resource),
		getCluster: vi.fn(async () => ({ clusterId: "test", config: {}, revision: "r", fields: [] })),
		updateConfig: vi.fn<IPaasUiService["updateConfig"]>(),
		getEvents: vi.fn(async () => []),
		getLogs: vi.fn(async () => ({ containerId: "c", content: "live", tail: 200 as const })),
	} satisfies IPaasUiService;
	const changes = new ChangeBus();
	return { ui, config, changes, cache: new CachedPaasUiService(ui, config, changes) };
};

test("startup refresh warms list and configured services; reads remain memory-only and isolated", async () => {
	const f = fixture();
	await f.cache.refresh();
	const list = await f.cache.listServices();
	list[0]!.health = "Missing";
	const detail = await f.cache.getService("demo");
	detail.resources.length = 0;
	expect((await f.cache.listServices())[0]!.health).toBe("Healthy");
	expect((await f.cache.getService("demo")).resources).toHaveLength(1);
	expect(f.ui.listServices).toHaveBeenCalledTimes(1);
	expect(f.ui.getService).toHaveBeenCalledTimes(1);
});

test("concurrent resource misses share a load; periodic refresh updates previously read resources", async () => {
	const f = fixture();
	await Promise.all([f.cache.getResource("demo", "app"), f.cache.getResource("demo", "app")]);
	expect(f.ui.getResource).toHaveBeenCalledTimes(1);
	f.ui.getResource.mockResolvedValue({
		resourceId: "app",
		type: "web",
		sync: "OutOfSync",
		health: "Missing",
		containers: [],
	});
	await f.cache.refresh();
	expect(await f.cache.getResource("demo", "app")).toMatchObject({ health: "Missing" });
	expect(f.ui.getResource).toHaveBeenCalledTimes(2);
});

test("warm reads do not wait for background refresh, which publishes only after replacement", async () => {
	const f = fixture();
	await f.cache.refresh();
	const receive = vi.fn();
	f.changes.subscribe(receive);
	let release = () => {};
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	f.ui.getService.mockImplementationOnce(async () => {
		await blocked;
		return {
			serviceId: "demo",
			source: {},
			sync: "OutOfSync",
			health: "Missing",
			descriptorStatus: "unavailable",
			resources: [],
		};
	});
	const refreshing = f.cache.refresh();
	expect((await f.cache.getService("demo")).health).toBe("Healthy");
	expect(receive).not.toHaveBeenCalled();
	release();
	await refreshing;
	expect((await f.cache.getService("demo")).health).toBe("Missing");
	expect(receive).toHaveBeenCalled();
});

test("a refresh replaces a cold fill started before its observation", async () => {
	const f = fixture();
	let release = () => {};
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	f.ui.getResource.mockImplementationOnce(async () => {
		await blocked;
		return { resourceId: "app", type: "web", sync: "Synced", health: "Healthy", containers: [] };
	});
	const old = f.cache.getResource("demo", "app");
	f.ui.getResource.mockResolvedValue({
		resourceId: "app",
		type: "web",
		sync: "OutOfSync",
		health: "Missing",
		containers: [],
	});
	const refreshing = f.cache.refresh();
	await Promise.resolve();
	release();
	await Promise.all([old, refreshing]);
	expect((await f.cache.getResource("demo", "app")).health).toBe("Missing");
	expect(f.ui.getResource).toHaveBeenCalledTimes(2);
});

test("concurrent list/service misses share loads and cold failures are cached until refresh", async () => {
	const f = fixture();
	await Promise.all([
		f.cache.listServices(),
		f.cache.listServices(),
		f.cache.getService("demo"),
		f.cache.getService("demo"),
	]);
	expect(f.ui.listServices).toHaveBeenCalledTimes(1);
	expect(f.ui.getService).toHaveBeenCalledTimes(1);
	f.ui.getResource.mockRejectedValueOnce(new Error("Docker unavailable"));
	await expect(f.cache.getResource("demo", "app")).rejects.toThrow("Docker unavailable");
	await expect(f.cache.getResource("demo", "app")).rejects.toThrow("Docker unavailable");
	expect(f.ui.getResource).toHaveBeenCalledTimes(1);
	await f.cache.refresh();
	expect((await f.cache.getResource("demo", "app")).health).toBe("Healthy");
});

test("failed refreshes replace stale snapshots, isolate services and retry only on refresh", async () => {
	const f = fixture();
	await f.cache.refresh();
	f.ui.getService.mockRejectedValueOnce(new Error("inspection unavailable"));
	await f.cache.refresh();
	await expect(f.cache.getService("demo")).rejects.toThrow("inspection unavailable");
	await expect(f.cache.getService("demo")).rejects.toThrow("inspection unavailable");
	expect(f.ui.getService).toHaveBeenCalledTimes(2);
	expect(await f.cache.listServices()).toHaveLength(1);
	await f.cache.refresh();
	expect((await f.cache.getService("demo")).health).toBe("Healthy");
});

test("configuration changes discard old cache entries and in-flight fills cannot restore them", async () => {
	const f = fixture();
	let release = () => {};
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	f.ui.getService.mockImplementationOnce(async () => {
		await blocked;
		return {
			serviceId: "demo",
			source: {},
			sync: "Synced",
			health: "Healthy",
			descriptorStatus: "unavailable",
			resources: [],
		};
	});
	const old = f.cache.getService("demo");
	f.config.getServices = () => ({ demo: { remote: "https://example.test/new", descriptorPath: "new.yaml" } });
	f.ui.getService.mockResolvedValue({
		serviceId: "demo",
		source: {},
		sync: "OutOfSync",
		health: "Missing",
		descriptorStatus: "unavailable",
		resources: [],
	});
	expect((await f.cache.getService("demo")).health).toBe("Missing");
	release();
	expect((await old).health).toBe("Missing");
	f.config.getServices = () => ({});
	await expect(f.cache.getService("demo")).rejects.toMatchObject({ kind: "not-found" });
	await expect(f.cache.getResource("demo", "app")).rejects.toMatchObject({ kind: "not-found" });
});

test("events, logs and configuration delegate without caching", async () => {
	const f = fixture();
	for (let i = 0; i < 2; i++) {
		await f.cache.getEvents("demo");
		await f.cache.getLogs("demo", "app", "c");
		await f.cache.getCluster();
	}
	expect(f.ui.getEvents).toHaveBeenCalledTimes(2);
	expect(f.ui.getLogs).toHaveBeenCalledTimes(2);
	expect(f.ui.getCluster).toHaveBeenCalledTimes(2);
});
