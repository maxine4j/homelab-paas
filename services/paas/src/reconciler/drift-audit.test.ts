import { expect, test, vi } from "vitest";

import type { DockerContainerDetails, DockerNetwork, ServiceContainer } from "../docker/types.ts";
import { testConfig } from "../util/test/config.ts";
import { DriftAudit } from "./drift-audit.ts";
import { ResourceRoutingPolicy } from "./networking/resource-routing-policy.ts";
import type { Endpoint } from "./networking/types.ts";
import { ResourceSpecification } from "./resource-specification.ts";

test.each([
	{ address: "10.0.0.9" },
	{ port: 9090 },
	{ public: false },
	{ primary: false },
	{ healthcheckPath: "/different" },
	{ static: true },
])("web route policy drift schedules repair: %j", async (change: Partial<Endpoint>) => {
	const f = fixture();
	f.routes.getAll.mockResolvedValue({
		"app.demo": { address: "10.0.0.2", port: 8080, public: true, primary: true, ...change },
		"unsupported.removed": { address: "10.0.0.3", port: 80, public: false },
	});
	await f.audit.run();
	expect(f.scheduler.invalidate).toHaveBeenCalledWith("demo");
});

test("static-only audits repair file and route drift without requiring a service network", async () => {
	const inspect = vi.fn(async () => "current" as "current" | "different");
	const invalidate = vi.fn();
	const docker = {
		listServiceContainers: vi.fn(async () => []),
		inspectServiceContainer: vi.fn(async () => null),
		inspectServiceNetwork: vi.fn(async () => null),
	};
	const peers = { inspectServiceInfrastructure: vi.fn(async () => false) };
	const routes = { "site.demo": { address: "127.0.0.1", port: 8081, static: true, public: false, primary: true } };
	const audit = new DriftAudit(
		new ResourceRoutingPolicy(),
		testConfig({ services: { demo: { remote: "repo", descriptorPath: "sd.yaml" } } }),
		{
			read: async () => ({
				revision: "rev",
				secrets: [],
				resources: [["site", { type: "static", path: "dist", primary: true }]],
			}),
		},
		docker,
		peers,
		new ResourceSpecification(),
		{ invalidate, refreshInputs: async () => {} },
		{ getAll: async () => routes },
		{ verifyRoutes: async () => {} },
		{ invalidateService: () => {} },
		{ refresh: async () => {} },
		() => {},
		() => "audit",
		{ inspect },
	);
	await audit.run();
	expect(invalidate).not.toHaveBeenCalled();
	expect(peers.inspectServiceInfrastructure).not.toHaveBeenCalled();
	inspect.mockResolvedValue("different");
	await audit.run();
	expect(invalidate).toHaveBeenCalledWith("demo");
	inspect.mockResolvedValue("current");
	invalidate.mockClear();
	routes["site.demo"].primary = false;
	await audit.run();
	expect(invalidate).toHaveBeenCalledWith("demo");
	for (const change of [
		{ address: "10.0.0.9" },
		{ port: 80 },
		{ public: true },
		{ primary: false },
		{ static: false },
		{ healthcheckPath: "/wrong" },
	]) {
		Object.assign(
			routes["site.demo"],
			{
				address: "127.0.0.1",
				port: 8081,
				static: true,
				public: false,
				primary: true,
				healthcheckPath: undefined,
			},
			change,
		);
		invalidate.mockClear();
		await audit.run();
		expect(invalidate).toHaveBeenCalledWith("demo");
	}
});

const fixture = () => {
	const resource = { type: "web" as const, image: "image", ingress: { port: 8080, public: true }, primary: true };
	const specification = new ResourceSpecification();
	const current: ServiceContainer = {
		id: "container",
		imageId: "image",
		state: "running",
		resourceId: "app",
		revision: "rev",
		spec: specification.get("app", resource),
	};
	const details: DockerContainerDetails = {
		id: "container",
		imageId: "image",
		running: true,
		labels: {},
		limits: { nanoCpus: 0, memoryBytes: 0 },
		networks: { network: { address: "10.0.0.2", aliases: ["app"] } },
	};
	const network: DockerNetwork = {
		id: "network-id",
		name: "network",
		driver: "bridge",
		labels: {},
		containerIds: ["container"],
	};
	const docker = {
		listServiceContainers: vi.fn(async () => [current]),
		inspectServiceContainer: vi.fn(async () => details),
		inspectServiceNetwork: vi.fn(async () => network),
	};
	const scheduler = { invalidate: vi.fn(), refreshInputs: vi.fn(async () => {}), settle: vi.fn(async () => {}) };
	const inputs = {
		read: vi.fn(async () => ({
			revision: "rev",
			secrets: [],
			resources: [["app", resource] as [string, typeof resource]],
		})),
	};
	const peers = { inspectServiceInfrastructure: vi.fn(async () => true) };
	const routes = {
		getAll: vi.fn(async (): Promise<Record<string, Endpoint>> => ({
			"app.demo": { address: "10.0.0.2", port: 8080, public: true, primary: true },
			"unsupported.removed": { address: "10.0.0.3", port: 80, public: false },
		})),
	};
	const routing = { verifyRoutes: vi.fn(async () => {}) };
	const health = { invalidateService: vi.fn() };
	const state = { refresh: vi.fn(async () => {}) };
	const remember = vi.fn();
	const cleanup = { run: vi.fn(async () => {}) };
	const config = testConfig({ services: { demo: { remote: "repo", descriptorPath: "sd.yaml" } } });
	const audit = new DriftAudit(
		new ResourceRoutingPolicy(),
		config,
		inputs,
		docker,
		peers,
		specification,
		scheduler,
		routes,
		routing,
		health,
		state,
		remember,
		() => "audit-id",
		undefined,
		cleanup,
	);
	return {
		audit,
		config,
		cleanup,
		docker,
		current,
		details,
		network,
		scheduler,
		inputs,
		peers,
		routes,
		routing,
		health,
		state,
		remember,
	};
};

test("every audit checks orphan workloads even when desired-input observation fails", async () => {
	const f = fixture();
	await f.audit.run();
	expect(f.cleanup.run).toHaveBeenCalledTimes(1);
	f.inputs.read.mockRejectedValueOnce(new Error("unavailable"));
	await expect(f.audit.run()).rejects.toThrow("Safety audit failed");
	expect(f.cleanup.run).toHaveBeenCalledTimes(2);
	f.cleanup.run.mockRejectedValueOnce(new Error("cleanup unavailable"));
	await expect(f.audit.run()).rejects.toThrow("Safety audit failed");
	expect(f.routing.verifyRoutes).toHaveBeenCalledTimes(3);
});

test("startup and subsequent audits clean orphan workloads when the last configured service was removed", async () => {
	const f = fixture();
	delete f.config.getServices()["demo"];
	await f.audit.run();
	await f.audit.run();
	expect(f.cleanup.run).toHaveBeenCalledTimes(2);
	expect(f.inputs.read).not.toHaveBeenCalled();
});

test("unchanged audit verifies routing without scheduling replacement or overwriting incomplete route inventory", async () => {
	const f = fixture();
	await f.audit.run();
	expect(f.scheduler.refreshInputs).toHaveBeenCalledWith("demo");
	expect(f.scheduler.invalidate).not.toHaveBeenCalled();
	expect(f.routing.verifyRoutes.mock.calls).toEqual([[]]);
	expect(f.remember).toHaveBeenCalledWith("network-id", "demo");
});

test("equivalent persisted defaults and null healthchecks do not schedule deployment", async () => {
	const f = fixture();
	f.routes.getAll.mockResolvedValue({
		"app.demo": { address: "10.0.0.2", port: 8080, public: true, static: false, healthcheckPath: null },
		"unsupported.removed": { address: "10.0.0.3", port: 80, public: false },
	});
	await f.audit.run();
	expect(f.scheduler.invalidate).not.toHaveBeenCalled();
});

test.each(["stop", "missing", "network", "alias", "limits", "peer", "route"])(
	"missed %s event is repaired by targeted audit",
	async (drift) => {
		const f = fixture();
		if (drift === "stop") f.current.state = "exited";
		if (drift === "missing") f.docker.listServiceContainers.mockResolvedValue([]);
		if (drift === "network") f.network.containerIds = [];
		if (drift === "alias") f.details.networks["network"]!.aliases = [];
		if (drift === "limits") f.details.limits!.nanoCpus = 1e9;
		if (drift === "peer") f.peers.inspectServiceInfrastructure.mockResolvedValue(false);
		if (drift === "route")
			f.routes.getAll.mockResolvedValue({
				"app.demo": { address: "10.0.0.9", port: 8080, public: true, primary: true },
				"unsupported.removed": { address: "10.0.0.3", port: 80, public: false },
			});
		await f.audit.run();
		expect(f.scheduler.invalidate).toHaveBeenCalledWith("demo");
	},
);

test("failed/incomplete inventory invalidates old health, retains routes and pending work, and reports failure", async () => {
	const f = fixture();
	f.docker.inspectServiceContainer.mockRejectedValue(new Error("unavailable"));
	await expect(f.audit.run()).rejects.toThrow("Safety audit failed");
	expect(f.health.invalidateService).toHaveBeenCalledWith("demo");
	expect(f.scheduler.invalidate).toHaveBeenCalledWith("demo");
	expect(f.routing.verifyRoutes.mock.calls).toEqual([[]]);
	await f.audit.stop();
});

test("scan requests overlapping initial inventory are retained and serialized", async () => {
	const f = fixture();
	let release!: () => void;
	f.docker.listServiceContainers.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = () => resolve([f.current]);
			}),
	);
	const initial = f.audit.run();
	await vi.waitFor(() => expect(release).toBeDefined());
	const again = f.audit.run();
	f.current.state = "exited";
	release();
	await Promise.all([initial, again]);
	expect(f.docker.listServiceContainers).toHaveBeenCalledTimes(2);
	expect(f.scheduler.invalidate).toHaveBeenCalledWith("demo");
});

test("uncertain routing fails visibly and schedules recovery without replacing preserved route state", async () => {
	const f = fixture();
	f.routing.verifyRoutes.mockRejectedValue(new Error("not accepted"));
	await expect(f.audit.run()).rejects.toThrow("Safety audit failed");
	expect(f.scheduler.invalidate).toHaveBeenCalledWith("demo");
	expect(f.health.invalidateService).toHaveBeenCalledWith("demo");
});

test("a request during final route verification awaits its retained inventory before resolving", async () => {
	const f = fixture();
	let release!: () => void;
	f.routing.verifyRoutes.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
			}),
	);
	const first = f.audit.run();
	await vi.waitFor(() => expect(release).toBeDefined());
	const second = f.audit.run("demo");
	f.current.state = "exited";
	release();
	await second;
	expect(f.docker.listServiceContainers).toHaveBeenCalledTimes(2);
	expect(f.scheduler.invalidate).toHaveBeenCalledWith("demo");
	await first;
});

test("unobserved live limits remain unavailable rather than assuming specification labels prove compliance", async () => {
	const f = fixture();
	delete f.details.limits;
	await expect(f.audit.run()).rejects.toThrow("Safety audit failed");
	expect(f.health.invalidateService).toHaveBeenCalledWith("demo");
});
