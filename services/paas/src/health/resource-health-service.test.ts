import { expect, test, vi } from "vitest";

import { decodeDescriptorYaml, parseConfig } from "../config/paas-config.ts";
import type { DockerContainerDetails, ServiceContainer } from "../docker/types.ts";
import { ChangeBus } from "../events/change-bus.ts";
import { testConfig } from "../util/test/config.ts";
import { ResourceHealthService } from "./resource-health-service.ts";

const fixture = (
	type: "web" | "worker" = "web",
	replicas = 1,
	healthcheck: { healthcheckUrl?: string | null } = { healthcheckUrl: "/ready" },
) => {
	const config = testConfig(
		parseConfig({
			version: 1,
			metadata: { clusterId: "local" },
			ingress: { baseDomain: "example.com" },
			git: { operationTimeoutSeconds: 60 },
			reconciliation: { retryBackoffSeconds: 5, maxRetryBackoffSeconds: 60 },
			services: { demo: { remote: "local", descriptorPath: "/demo.yaml" } },
		}),
	);
	const containers: ServiceContainer[] = [
		{ id: "c", resourceId: "app", revision: "rev", spec: "s", imageId: "image", state: "running" },
	];
	const fetchFile = vi.fn(async () => ({
		revision: "rev",
		content: JSON.stringify({
			version: 1,
			metadata: { serviceId: "demo" },
			resources: {
				app:
					type === "web"
						? { type, image: "app:1", ingress: { port: 80, public: true }, ...healthcheck }
						: { type, image: "app:1", healthcheckPort: 9000, replicas, ...healthcheck },
			},
		}),
	}));
	const inspectServiceContainer = vi.fn(
		async (_serviceId: string, id: string): Promise<DockerContainerDetails | null> => ({
			id,
			imageId: "image",
			running: true,
			labels: {},
			networks: { internal: { address: "172.1.0.2", aliases: [] } },
		}),
	);
	const listServiceContainers = vi.fn(async () => containers);
	const probe = vi.fn(async () => true);
	const changes = new ChangeBus();
	const receive = vi.fn();
	changes.subscribe(receive);
	const health = new ResourceHealthService(
		config,
		{ fetchFile },
		decodeDescriptorYaml,
		{
			listServiceContainers,
			inspectServiceContainer,
			inspectServiceNetwork: async () => ({
				id: "net",
				name: "internal",
				driver: "bridge",
				labels: {},
				containerIds: containers.map(({ id }) => id),
			}),
		},
		probe,
		changes,
	);
	return { health, config, containers, probe, receive, fetchFile, listServiceContainers, inspectServiceContainer };
};

test.each(["web", "worker"] as const)("%s health uses running state when no URL is configured", async (type) => {
	for (const healthcheckUrl of [undefined, null]) {
		const f = fixture(type, 1, { healthcheckUrl });
		f.probe.mockResolvedValue(false);
		await f.health.run();
		expect(f.health.getStatus("demo", "app", f.containers)).toBe("healthy");
		expect(f.probe).not.toHaveBeenCalled();
		f.containers[0]!.state = "exited";
		await f.health.run();
		expect(f.health.getStatus("demo", "app", f.containers)).toBe("unhealthy");
	}
});

test("polls web readiness independently of reconciliation and pushes only changes", async () => {
	const f = fixture();
	expect(f.health.getStatus("demo", "app", [])).toBe("missing");
	expect(f.health.getStatus("demo", "app", f.containers)).toBe("unhealthy");
	await f.health.run();
	expect(f.probe).toHaveBeenCalledWith("172.1.0.2", 80, "/ready");
	expect(f.health.getStatus("demo", "app", f.containers)).toBe("healthy");
	f.receive.mockClear();
	await f.health.run();
	expect(f.receive).not.toHaveBeenCalled();
	f.probe.mockResolvedValue(false);
	await f.health.run();
	expect(f.health.getStatus("demo", "app", f.containers)).toBe("unhealthy");
	expect(f.receive).toHaveBeenCalledWith({ serviceId: "demo" });
	f.probe.mockResolvedValue(true);
	await f.health.run();
	expect(f.health.getStatus("demo", "app", f.containers)).toBe("healthy");
});

test("workers require all expected replicas to pass private health checks", async () => {
	const f = fixture("worker", 2);
	await f.health.run();
	expect(f.health.getStatus("demo", "app", f.containers)).toBe("unhealthy");
	f.containers.push({ ...f.containers[0]!, id: "second" });
	await f.health.run();
	expect(f.probe).toHaveBeenCalledWith("172.1.0.2", 9000, "/ready");
	expect(f.health.getStatus("demo", "app", f.containers)).toBe("healthy");
	f.probe.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
	await f.health.run();
	expect(f.health.getStatus("demo", "app", f.containers)).toBe("unhealthy");
});

test("stopped, disconnected, replaced and missing containers cannot inherit healthy status", async () => {
	const f = fixture();
	await f.health.run();
	f.containers[0]!.id = "replacement";
	expect(f.health.getStatus("demo", "app", f.containers)).toBe("unhealthy");
	f.containers[0]!.state = "exited";
	await f.health.run();
	expect(f.health.getStatus("demo", "app", f.containers)).toBe("unhealthy");
	f.containers[0]!.state = "running";
	f.inspectServiceContainer.mockResolvedValue({
		id: "replacement",
		imageId: "image",
		running: true,
		labels: {},
		networks: {},
	});
	await f.health.run();
	expect(f.health.getStatus("demo", "app", f.containers)).toBe("unhealthy");
	f.containers.length = 0;
	await f.health.run();
	expect(f.health.getStatus("demo", "app", [])).toBe("missing");
});

test("resource rollout overrides polling without marking other resources deploying; finishing invalidates in-flight probes", async () => {
	const f = fixture();
	let resolve!: (healthy: boolean) => void;
	f.probe.mockImplementationOnce(
		() =>
			new Promise<boolean>((done) => {
				resolve = done;
			}),
	);
	const polling = f.health.run();
	await vi.waitFor(() => expect(f.probe).toHaveBeenCalled());
	f.health.started("demo", "app");
	expect(f.health.getStatus("demo", "app", [])).toBe("deploying");
	expect(f.health.getStatus("demo", "other", [])).toBe("missing");
	f.health.finished("demo", "app");
	resolve(true);
	await polling;
	expect(f.health.getStatus("demo", "app", f.containers)).toBe("unhealthy");
	await f.health.run();
	expect(f.health.getStatus("demo", "app", f.containers)).toBe("healthy");
});

test("descriptor and Docker failures invalidate prior health and recover on later polls", async () => {
	const f = fixture();
	await f.health.run();
	f.fetchFile.mockRejectedValueOnce(new Error("private source error"));
	await f.health.run();
	expect(f.health.getStatus("demo", "app", f.containers)).toBe("unhealthy");
	await f.health.run();
	expect(f.health.getStatus("demo", "app", f.containers)).toBe("healthy");
	f.listServiceContainers.mockRejectedValueOnce(new Error("Docker unavailable"));
	await f.health.run();
	expect(f.health.getStatus("demo", "app", f.containers)).toBe("unhealthy");
});

test("one service or resource failure cannot hide another resource's health", async () => {
	const f = fixture();
	f.config.getServices = () => ({
		demo: { remote: "local", descriptorPath: "/demo.yaml" },
		offline: { remote: "local", descriptorPath: "/offline.yaml" },
	});
	f.fetchFile.mockImplementation(async (serviceId?: string) => {
		if (serviceId === "offline") throw new Error("offline source");
		return {
			revision: "rev",
			content: JSON.stringify({
				version: 1,
				metadata: { serviceId: "demo" },
				resources: {
					app: { type: "web", image: "app:1", ingress: { port: 80, public: true }, healthcheckUrl: "/ready" },
					jobs: { type: "worker", image: "jobs:1", healthcheckPort: 9000, healthcheckUrl: "/ready" },
				},
			}),
		};
	});
	f.containers.push({ ...f.containers[0]!, id: "jobs", resourceId: "jobs" });
	f.inspectServiceContainer.mockImplementation(async (_serviceId, id) => {
		if (id === "jobs") throw new Error("inspection failed");
		return {
			id,
			imageId: "image",
			running: true,
			labels: {},
			networks: { internal: { address: "172.1.0.2", aliases: [] } },
		};
	});
	await f.health.run();
	expect(
		f.health.getStatus(
			"demo",
			"app",
			f.containers.filter(({ resourceId }) => resourceId === "app"),
		),
	).toBe("healthy");
	expect(
		f.health.getStatus(
			"demo",
			"jobs",
			f.containers.filter(({ resourceId }) => resourceId === "jobs"),
		),
	).toBe("unhealthy");
});

test("observed-only and unsupported resources never report health from container running state", async () => {
	const f = fixture();
	f.fetchFile.mockResolvedValueOnce({
		revision: "rev",
		content: JSON.stringify({
			version: 1,
			metadata: { serviceId: "demo" },
			resources: { db: { type: "postgres", image: "postgres:17" } },
		}),
	});
	f.containers.push({ ...f.containers[0]!, id: "db", resourceId: "db" });
	await f.health.run();
	for (const resourceId of ["app", "db"])
		expect(
			f.health.getStatus(
				"demo",
				resourceId,
				f.containers.filter((container) => container.resourceId === resourceId),
			),
		).toBe("unhealthy");
	expect(f.probe).not.toHaveBeenCalled();
});
