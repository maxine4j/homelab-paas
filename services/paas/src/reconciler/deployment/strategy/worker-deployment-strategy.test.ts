import { expect, test, vi } from "vitest";

import type { IDockerService } from "../../../docker/docker-service.ts";
import type { ServiceContainer } from "../../../docker/types.ts";
import { captureLogs } from "../../../util/test/logs.ts";
import { ResourceSpecification } from "../../resource-specification.ts";
import { DeploymentContainers } from "../deployment-containers.ts";
import { DeploymentService } from "../deployment-service.ts";
import type { WorkerDeploymentRequest } from "../types.ts";
import { WorkerDeploymentStrategy } from "./worker-deployment-strategy.ts";

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
		devices: [{ hostPath: "/dev/dri", mountPath: "/dev/dri" }],
		supplementaryGroups: [109],
		selinuxLabeling: false,
		limits: { cpus: 0.5, memoryMiB: 256 },
		termination: { timeoutSeconds: 60 },
	},
};

test("worker recreate protects its resolved image during predecessor retirement", async () => {
	const f = fixture();
	f.old();
	await f.service.deploy(request);
	expect(f.docker.removeServiceContainer).toHaveBeenCalledWith("demo", "old", "image");
});

test.each(["limits", "alias"])("does not retain worker replicas with observed %s drift", async (drift) => {
	const f = fixture();
	f.old("old", request.spec);
	const inspect = vi.mocked(f.docker.inspectServiceContainer).getMockImplementation()!;
	vi.mocked(f.docker.inspectServiceContainer).mockImplementation(async (service, id) => {
		const details = (await inspect(service, id))!;
		return {
			...details,
			limits: { nanoCpus: id === "old" && drift === "limits" ? 1e9 : 0.5e9, memoryBytes: 256 * 1048576 },
			networks: { network: { address: id, aliases: id === "old" && drift === "alias" ? [] : ["jobs"] } },
		};
	});
	await f.service.deploy(request);
	expect(f.containers.has("old")).toBe(false);
});

test.each([
	["missing", "container is no longer present"],
	["stopped", "container is not running"],
	["address", "container has no address on the service network"],
	["probe", "private health check on port 9090 at /ready did not pass"],
] as const)("reports the last observed worker readiness condition: %s", async (condition, reason) => {
	const f = fixture();
	if (condition === "missing") vi.mocked(f.docker.inspectServiceContainer).mockResolvedValue(null);
	if (condition === "stopped" || condition === "address")
		vi.mocked(f.docker.inspectServiceContainer).mockResolvedValue({
			id: "new-1",
			imageId: "image",
			labels: {},
			running: condition !== "stopped",
			networks: {},
		});
	f.probe.mockResolvedValue(false);
	await expect(f.service.deploy(request)).rejects.toThrow(`Worker readiness failed after 30 checks: ${reason}`);
	expect(f.sleep).toHaveBeenCalledTimes(29);
});

test.each([undefined, null])("workers become ready without HTTP checks: %s", async (healthcheckUrl) => {
	const f = fixture();
	f.probe.mockResolvedValue(false);
	await f.service.deploy({ ...request, resource: { ...request.resource, healthcheckUrl } });
	expect([...f.containers.values()].every(({ state }) => state === "running")).toBe(true);
	expect(f.containers.size).toBe(2);
	expect(f.probe).not.toHaveBeenCalled();
});

test("failed worker rollout clears deploying health", async () => {
	const f = fixture();
	const progress = { started: vi.fn(), succeeded: vi.fn(), failed: vi.fn() };
	vi.mocked(f.docker.resolveImage).mockRejectedValue(new Error("pull failed"));
	const service = new DeploymentService(
		[
			new WorkerDeploymentStrategy(
				"recreate",
				f.docker,
				new DeploymentContainers(f.docker, f.probe, f.sleep),
				() => "id",
				new ResourceSpecification(),
			),
		],
		progress,
	);
	await expect(service.deploy(request)).rejects.toThrow("pull failed");
	expect(progress.failed).toHaveBeenCalledWith("demo", "jobs", "rev2");
});

test.each(["recreate", "surge"] as const)(
	"forced %s replaces every healthy replica and retains mounts",
	async (rolloutStrategy) => {
		const f = fixture();
		f.old("old-one", request.spec);
		f.old("old-two", request.spec);
		await f.service.deploy({ ...request, force: true, resource: { ...request.resource, rolloutStrategy } });
		expect([...f.containers.keys()]).toEqual(["new-1", "new-2"]);
		expect(f.docker.createResourceContainer).toHaveBeenCalledWith(
			expect.objectContaining({ volumes: request.resource.volumes }),
		);
		const stop = f.events.indexOf("stop:old-one");
		const ready = f.events.indexOf("probe:new-2");
		expect(rolloutStrategy === "surge" ? stop > ready : stop < ready).toBe(true);
	},
);

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
			limits: { nanoCpus: 0.5e9, memoryBytes: 256 * 1048576 },
			networks: { network: { address: id, aliases: ["jobs"] } },
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
		service: new DeploymentService(
			(["recreate", "surge"] as const).map(
				(name) =>
					new WorkerDeploymentStrategy(
						name,
						docker,
						new DeploymentContainers(docker, probe, sleep),
						() => "instance-" + ++instance,
						new ResourceSpecification(),
					),
			),
		),
		old(id = "old", spec = "previous", state = "running") {
			containers.set(id, { id, spec, state, resourceId: "jobs", revision: "rev1", imageId: "old-image" });
		},
	};
};

test("worker recreate passes host bindings after retiring the predecessor", async () => {
	const f = fixture();
	f.old();
	const hostPorts = [{ protocol: "udp" as const, containerPort: 8080, hostPort: 18080, bindAddress: "0.0.0.0" }];
	await f.service.deploy({
		...request,
		resource: { ...request.resource, replicas: 1, rolloutStrategy: "recreate", hostPorts },
	});
	expect(f.docker.createResourceContainer).toHaveBeenCalledWith(expect.objectContaining({ hostPorts }));
	expect(f.events.indexOf("stop:old")).toBeLessThan(f.events.indexOf("create:new-1"));
});

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
			devices: request.resource.devices,
			supplementaryGroups: request.resource.supplementaryGroups,
			selinuxLabeling: false,
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

test.each(["stopServiceContainer", "removeServiceContainer"] as const)(
	"cleans all failed candidates and preserves startup and cleanup failures: %s",
	async (method) => {
		const f = fixture();
		f.old();
		const startup = new Error("second start failed");
		const cleanup = new Error("first cleanup failed");
		vi.mocked(f.docker.startServiceContainer)
			.mockImplementationOnce(async (_serviceId, id) => {
				f.containers.get(id)!.state = "running";
			})
			.mockRejectedValueOnce(startup);
		if (method === "stopServiceContainer") {
			const retire = vi.mocked(f.docker.stopServiceContainer).getMockImplementation()!;
			vi.mocked(f.docker.stopServiceContainer).mockImplementation(async (serviceId, id, timeout) => {
				if (id === "new-1") throw cleanup;
				await retire(serviceId, id, timeout);
			});
		} else {
			const retire = vi.mocked(f.docker.removeServiceContainer).getMockImplementation()!;
			vi.mocked(f.docker.removeServiceContainer).mockImplementation(async (serviceId, id, preserveImageId) => {
				if (id === "new-1") throw cleanup;
				await retire(serviceId, id, preserveImageId);
			});
		}
		await expect(
			f.service.deploy({ ...request, resource: { ...request.resource, rolloutStrategy: "surge" } }),
		).rejects.toMatchObject({
			message: "Worker startup and cleanup failed",
			errors: [startup, expect.objectContaining({ errors: [cleanup] })],
		});
		expect(f.docker.stopServiceContainer).toHaveBeenCalledWith("demo", "new-2", 60);
		expect(f.docker.removeServiceContainer).toHaveBeenCalledWith("demo", "new-2");
		expect(f.docker.stopServiceContainer).not.toHaveBeenCalledWith("demo", "old", expect.anything());
	},
);

test("failure to create the second replica cleans the earlier success and preserves predecessors", async () => {
	const f = fixture();
	f.old();
	const failure = new Error("second create failed");
	const create = vi.mocked(f.docker.createResourceContainer).getMockImplementation()!;
	vi.mocked(f.docker.createResourceContainer).mockImplementationOnce(create).mockRejectedValueOnce(failure);
	await expect(
		f.service.deploy({ ...request, resource: { ...request.resource, rolloutStrategy: "surge" } }),
	).rejects.toBe(failure);
	expect([...f.containers.keys()]).toEqual(["old"]);
	expect(f.docker.stopServiceContainer).toHaveBeenCalledExactlyOnceWith("demo", "new-1", 60);
	expect(f.docker.removeServiceContainer).toHaveBeenCalledExactlyOnceWith("demo", "new-1");
});

test("failed replica cleanup and prior-success cleanup both preserve their failures without duplicate retirement", async () => {
	const f = fixture();
	f.old();
	const startup = new Error("second start failed");
	const failedCandidateCleanup = new Error("second stop failed");
	const priorSuccessCleanup = new Error("first remove failed");
	const start = vi.mocked(f.docker.startServiceContainer).getMockImplementation()!;
	vi.mocked(f.docker.startServiceContainer).mockImplementationOnce(start).mockRejectedValueOnce(startup);
	const stop = vi.mocked(f.docker.stopServiceContainer).getMockImplementation()!;
	vi.mocked(f.docker.stopServiceContainer).mockImplementation(async (serviceId, id, timeout) => {
		if (id === "new-2") throw failedCandidateCleanup;
		await stop(serviceId, id, timeout);
	});
	vi.mocked(f.docker.removeServiceContainer).mockRejectedValueOnce(priorSuccessCleanup);
	await expect(
		f.service.deploy({ ...request, resource: { ...request.resource, rolloutStrategy: "surge" } }),
	).rejects.toMatchObject({
		message: "Worker startup and cleanup failed",
		errors: [
			expect.objectContaining({
				errors: [startup, expect.objectContaining({ errors: [failedCandidateCleanup] })],
			}),
			expect.objectContaining({ errors: [priorSuccessCleanup] }),
		],
	});
	expect(vi.mocked(f.docker.stopServiceContainer).mock.calls).toEqual([
		["demo", "new-2", 60],
		["demo", "new-1", 60],
	]);
	expect(f.docker.removeServiceContainer).toHaveBeenCalledExactlyOnceWith("demo", "new-1");
	expect([...f.containers.keys()]).toEqual(["old", "new-1", "new-2"]);
});

test("allows thirty readiness checks separately for each replica", async () => {
	const f = fixture();
	const attempts = new Map<string, number>();
	f.probe.mockImplementation(async (address) => {
		const attempt = (attempts.get(address) ?? 0) + 1;
		attempts.set(address, attempt);
		return attempt === 30;
	});
	await f.service.deploy(request);
	expect([...attempts.entries()]).toEqual([
		["new-1", 30],
		["new-2", 30],
	]);
	expect(f.sleep).toHaveBeenCalledTimes(58);
	expect(f.sleep).toHaveBeenCalledWith(1000);
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

test("a running desired worker detached from its network is replaced", async () => {
	const f = fixture();
	f.old("detached", "desired");
	vi.mocked(f.docker.inspectServiceNetwork).mockResolvedValueOnce({
		id: "net",
		name: "network",
		driver: "bridge",
		labels: {},
		containerIds: [],
	});
	await f.service.deploy({ ...request, resource: { ...request.resource, replicas: 1 } });
	expect([...f.containers.keys()]).toEqual(["new-1"]);
});

test("logs worker deployment outcomes without resolved environment values", async () => {
	const f = fixture();
	const logs = captureLogs();
	const resolvedValue = "worker-environment-canary";
	const input = { ...request, resource: { ...request.resource, env: [{ name: "TOKEN", value: resolvedValue }] } };
	try {
		await f.service.deploy(input);
		vi.mocked(f.docker.resolveImage).mockRejectedValueOnce(new Error("registry failure"));
		await expect(f.service.deploy({ ...input, spec: "changed" })).rejects.toThrow("registry failure");
	} finally {
		logs.restore();
	}
	expect(logs.lines.map((line) => JSON.parse(line).event)).toEqual([
		"deployment.started",
		"deployment.completed",
		"deployment.started",
		"deployment.failed",
	]);
	expect(logs.lines.join("")).not.toContain(resolvedValue);
});

test.each(["recreate", "surge"] as const)(
	"%s replaces only the missing or stopped desired replica",
	async (strategy) => {
		const f = fixture();
		f.old("healthy", "desired");
		f.old("stopped", "desired", "exited");
		await f.service.deploy({ ...request, resource: { ...request.resource, rolloutStrategy: strategy } });
		expect([...f.containers.keys()]).toEqual(["healthy", "new-1"]);
		expect(f.docker.createResourceContainer).toHaveBeenCalledTimes(1);
		expect(f.docker.stopServiceContainer).not.toHaveBeenCalledWith("demo", "healthy", expect.anything());
	},
);

test("default worker settings start one replica without HTTP checks and use the default stop timeout", async () => {
	const f = fixture();
	f.old();
	await f.service.deploy({ ...request, resource: { type: "worker", image: "worker:1", healthcheckPort: 8080 } });
	expect(f.docker.createResourceContainer).toHaveBeenCalledTimes(1);
	expect(f.probe).not.toHaveBeenCalled();
	expect(f.docker.stopServiceContainer).toHaveBeenCalledWith("demo", "old", 30);
});
