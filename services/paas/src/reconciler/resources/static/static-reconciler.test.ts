import { expect, test, vi } from "vitest";

import { InMemoryKeyValueStore } from "../../../store/in-memory-store.ts";
import { EndpointsStore } from "../../networking/endpoints-store.ts";
import { NetworkingService } from "../../networking/networking-service.ts";
import { StaticResourceReconciler } from "./static-reconciler.ts";

const fixture = () => {
	const bundle = [{ path: "index.html", content: new Uint8Array([1]) }];
	const readDirectory = vi.fn(async () => bundle);
	const inspect = vi.fn(async () => "missing" as "missing" | "current");
	const publish = vi.fn(async () => {});
	const routes = new EndpointsStore(new InMemoryKeyValueStore<unknown>());
	const configureRoutes = vi.fn(async () => {});
	const reconciler = new StaticResourceReconciler(
		{ readDirectory },
		{ inspect, publish },
		new NetworkingService(routes, { bootstrap: async () => {}, configureRoutes }),
	);
	const request = {
		serviceId: "demo",
		resourceId: "site",
		revision: "a".repeat(40),
		source: { remote: "local", descriptorPath: "/repo/service.yaml" },
		resource: { type: "static" as const, path: "dist", primary: true },
	};
	return { reconciler, request, bundle, readDirectory, inspect, publish, routes, configureRoutes };
};

test("publishes the exact bundle before routing with private ingress by default", async () => {
	const f = fixture();
	await f.reconciler.reconcile(f.request);
	expect(f.readDirectory).toHaveBeenCalledWith("demo", f.request.source, f.request.revision, "dist");
	expect(f.publish).toHaveBeenCalledWith(
		{ serviceId: "demo", resourceId: "site", revision: f.request.revision, path: "dist" },
		f.bundle,
	);
	expect(f.publish.mock.invocationCallOrder[0]).toBeLessThan(f.configureRoutes.mock.invocationCallOrder[0]!);
	expect(await f.routes.getAll()).toEqual({
		"site.demo": { address: "127.0.0.1", port: 8081, static: true, public: false, primary: true },
	});
	f.inspect.mockResolvedValue("current");
	f.publish.mockClear();
	await f.reconciler.reconcile({
		...f.request,
		resource: { ...f.request.resource, ingress: { public: true }, primary: false },
	});
	expect(f.publish).not.toHaveBeenCalled();
	expect((await f.routes.getAll())["site.demo"]).toMatchObject({ public: true, primary: false });
	await f.reconciler.reconcile({ ...f.request, force: true });
	expect(f.publish).toHaveBeenCalledTimes(1);
});

test("export and disk failures never publish a new route; route failures propagate for retry", async () => {
	const f = fixture();
	f.readDirectory.mockRejectedValueOnce(new Error("git failure"));
	await expect(f.reconciler.reconcile(f.request)).rejects.toThrow("git failure");
	expect(f.publish).not.toHaveBeenCalled();
	expect(f.configureRoutes).not.toHaveBeenCalled();
	f.publish.mockRejectedValueOnce(new Error("disk failure"));
	await expect(f.reconciler.reconcile(f.request)).rejects.toThrow("disk failure");
	expect(f.configureRoutes).not.toHaveBeenCalled();
	f.configureRoutes.mockRejectedValueOnce(new Error("envoy failure"));
	await expect(f.reconciler.reconcile(f.request)).rejects.toThrow();
});
