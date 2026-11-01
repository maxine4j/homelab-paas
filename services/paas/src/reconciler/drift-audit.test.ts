import { expect, test, vi } from "vitest";

import type { DockerContainerDetails, DockerNetwork, ServiceContainer } from "../docker/types.ts";
import { testConfig } from "../util/test/config.ts";
import { DriftAudit } from "./drift-audit.ts";
import { ResourceSpecification } from "./resource-specification.ts";

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
		getAll: vi.fn(async () => ({
			"app.demo": { address: "10.0.0.2", port: 8080, public: true, primary: true },
			"unsupported.removed": { address: "10.0.0.3", port: 80, public: false },
		})),
	};
	const routing = { verifyRoutes: vi.fn(async () => {}) };
	const health = { invalidateService: vi.fn() };
	const state = { refresh: vi.fn(async () => {}) };
	const remember = vi.fn();
	const audit = new DriftAudit(
		testConfig({ services: { demo: { remote: "repo", descriptorPath: "sd.yaml" } } }),
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
	);
	return {
		audit,
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

test("unchanged audit verifies routing without scheduling replacement or overwriting incomplete route inventory", async () => {
	const f = fixture();
	await f.audit.run();
	expect(f.scheduler.refreshInputs).toHaveBeenCalledWith("demo");
	expect(f.scheduler.invalidate).not.toHaveBeenCalled();
	expect(f.routing.verifyRoutes.mock.calls).toEqual([[]]);
	expect(f.remember).toHaveBeenCalledWith("network-id", "demo");
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
