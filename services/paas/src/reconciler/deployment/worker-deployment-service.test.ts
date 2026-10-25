import { expect, test, vi } from "vitest";

import type { IDockerService } from "../../docker/docker-service.ts";
import type { ServiceContainer } from "../../docker/types.ts";
import type { WorkerDeploymentRequest } from "./types.ts";
import { WorkerDeploymentService } from "./worker-deployment-service.ts";

const request: WorkerDeploymentRequest = {
	serviceId: "demo",
	resourceId: "jobs",
	revision: "rev2",
	spec: "desired",
	resource: {
		type: "worker",
		image: "worker:2",
		healthcheckPort: 9090,
		healthcheckUrl: "/ready",
		replicas: 2,
		env: [{ name: "TOKEN", value: "secret" }],
		volumes: [{ hostPath: "/srv/jobs", mountPath: "/data" }],
		limits: { cpus: 0.5, memoryMiB: 256 },
		termination: { timeoutSeconds: 60 },
	},
};

const fixture = () => {
	const containers = new Map<string, ServiceContainer>();
	const events: string[] = [];
	let sequence = 0;
	const docker: IDockerService = {
		listServiceContainers: vi.fn(async () => [...containers.values()]),
		inspectServiceContainer: vi.fn(async (_service, id) => ({
			id,
			imageId: "image",
			running: containers.get(id)?.state === "running",
			labels: {},
			networks: { network: { address: id, aliases: [] } },
		})),
		inspectServiceNetwork: vi.fn(async () => ({
			id: "net",
			name: "network",
			driver: "bridge",
			labels: {},
			containerIds: [...containers.keys()],
		})),
		prepareServiceNetwork: vi.fn(async () => {}),
		resolveImage: vi.fn(async () => "image"),
		createResourceContainer: vi.fn(async (options) => {
			const id = `new-${++sequence}`;
			events.push(`create:${id}`);
			containers.set(id, {
				id,
				resourceId: options.resourceId,
				revision: options.revision,
				spec: options.spec,
				imageId: options.imageId,
				state: "created",
			});
			return id;
		}),
		startServiceContainer: vi.fn(async (_service, id) => {
			events.push(`start:${id}`);
			containers.get(id)!.state = "running";
		}),
		stopServiceContainer: vi.fn(async (_service, id) => {
			events.push(`stop:${id}`);
			const container = containers.get(id);
			if (container) container.state = "exited";
		}),
		removeServiceContainer: vi.fn(async (_service, id) => {
			events.push(`remove:${id}`);
			containers.delete(id);
		}),
		readServiceContainerLogs: vi.fn(async () => ""),
	};
	const probe = vi.fn(async (address: string, _port: number, _path: string) => {
		events.push(`probe:${address}`);
		return true;
	});
	const sleep = vi.fn(async (_ms: number) => {});
	let instance = 0;
	return {
		containers,
		events,
		docker,
		probe,
		sleep,
		service: new WorkerDeploymentService(docker, probe, sleep, () => `instance-${++instance}`),
		old(id = "old", spec = "previous", state = "running") {
			containers.set(id, { id, spec, state, resourceId: "jobs", revision: "rev1", imageId: "old-image" });
		},
	};
};

test.each(["recreate", "surge"] as const)("%s starts and privately probes every worker replica", async (strategy) => {
	const f = fixture();
	f.old();
	await f.service.deploy({ ...request, resource: { ...request.resource, rolloutStrategy: strategy } });
	expect([...f.containers.keys()]).toEqual(["new-1", "new-2"]);
	expect(f.probe.mock.calls).toEqual([
		["new-1", 9090, "/ready"],
		["new-2", 9090, "/ready"],
	]);
	expect(f.docker.createResourceContainer).toHaveBeenCalledWith(
		expect.objectContaining({
			serviceId: "demo",
			resourceId: "jobs",
			revision: "rev2",
			spec: "desired",
			imageId: "image",
			env: { TOKEN: "secret" },
			volumes: request.resource.volumes,
			limits: request.resource.limits,
			instanceId: "instance-1",
		}),
	);
	expect(f.docker.stopServiceContainer).toHaveBeenCalledWith("demo", "old", 60);
	const retirement = f.events.indexOf("stop:old");
	if (strategy === "recreate") expect(retirement).toBeLessThan(f.events.indexOf("create:new-1"));
	else expect(retirement).toBeGreaterThan(f.events.indexOf("probe:new-2"));
});

test.each(["create", "start", "probe"] as const)(
	"failed surge %s cleans candidates and preserves the old revision",
	async (failure) => {
		const f = fixture();
		f.old();
		if (failure === "create")
			vi.mocked(f.docker.createResourceContainer).mockRejectedValueOnce(new Error("create failed"));
		if (failure === "start")
			vi.mocked(f.docker.startServiceContainer).mockRejectedValueOnce(new Error("start failed"));
		if (failure === "probe") f.probe.mockResolvedValue(false);
		await expect(
			f.service.deploy({ ...request, resource: { ...request.resource, rolloutStrategy: "surge" } }),
		).rejects.toThrow();
		expect([...f.containers.keys()]).toEqual(["old"]);
		expect(f.docker.stopServiceContainer).not.toHaveBeenCalledWith("demo", "old", expect.anything());
		if (failure === "probe") {
			expect(f.probe).toHaveBeenCalledTimes(30);
			expect(f.sleep).toHaveBeenCalledTimes(29);
		}
	},
);

test("failure of the second replica cleans every new candidate", async () => {
	const f = fixture();
	f.old();
	f.probe.mockImplementation(async (address) => address === "new-1");
	await expect(
		f.service.deploy({ ...request, resource: { ...request.resource, rolloutStrategy: "surge" } }),
	).rejects.toThrow("Worker readiness failed");
	expect([...f.containers.keys()]).toEqual(["old"]);
});

test("surge resumes ready desired replicas after interrupted predecessor retirement", async () => {
	const f = fixture();
	f.old();
	f.old("ready-1", "desired");
	f.old("ready-2", "desired");
	await f.service.deploy({ ...request, resource: { ...request.resource, rolloutStrategy: "surge" } });
	expect(f.docker.createResourceContainer).not.toHaveBeenCalled();
	expect(f.docker.resolveImage).not.toHaveBeenCalled();
	expect([...f.containers.keys()]).toEqual(["ready-1", "ready-2"]);
	expect(f.probe).toHaveBeenCalledTimes(2);
});

test("recreate resolves its image before stopping the active workers", async () => {
	const f = fixture();
	f.old();
	vi.mocked(f.docker.resolveImage).mockRejectedValueOnce(new Error("registry unavailable"));
	await expect(f.service.deploy(request)).rejects.toThrow("registry unavailable");
	expect(f.docker.stopServiceContainer).not.toHaveBeenCalled();
});

test("retirement attempts all replicas and preserves healthy replacements for retry", async () => {
	const f = fixture();
	f.old("old-1");
	f.old("old-2");
	vi.mocked(f.docker.stopServiceContainer).mockRejectedValueOnce(new Error("stop failed"));
	const input = { ...request, resource: { ...request.resource, rolloutStrategy: "surge" as const } };
	await expect(f.service.deploy(input)).rejects.toThrow("Worker retirement failed");
	expect([...f.containers.keys()]).toEqual(["old-1", "new-1", "new-2"]);
	await f.service.deploy(input);
	expect([...f.containers.keys()]).toEqual(["new-1", "new-2"]);
	expect(f.docker.createResourceContainer).toHaveBeenCalledTimes(2);
});
