import { expect, test, vi } from "vitest";

import type { IDockerService } from "../../docker/docker-service.ts";
import { DeploymentContainers } from "./deployment-containers.ts";
import type { ResolvedCandidate } from "./types.ts";

const candidate: ResolvedCandidate = {
	serviceId: "demo",
	resourceId: "app",
	revision: "rev",
	spec: "spec",
	instanceId: "attempt",
	imageId: "sha256:resolved",
	networkName: "network",
	resource: {
		type: "web",
		image: "app:tag",
		ingress: { port: 8080 },
		healthcheckUrl: "/ready",
		command: ["app"],
		env: [{ name: "TOKEN", value: "resolved-secret" }],
		volumes: [{ hostPath: "/srv/data", mountPath: "/data" }],
		devices: [{ hostPath: "/dev/dri", mountPath: "/dev/dri" }],
		supplementaryGroups: [109],
		selinuxLabeling: false,
		hostPorts: [{ protocol: "tcp", containerPort: 8080, hostPort: 8080, bindAddress: "127.0.0.1" }],
		limits: { cpus: 0.5, memoryMiB: 256 },
		termination: { timeoutSeconds: 60 },
	},
};

const fixture = () => {
	const docker = {
		createResourceContainer: vi.fn(async () => "new"),
		startServiceContainer: vi.fn(async () => {}),
		inspectServiceContainer: vi.fn<IDockerService["inspectServiceContainer"]>(async () => ({
			id: "new",
			imageId: candidate.imageId,
			running: true,
			labels: {},
			networks: { network: { address: "10.0.0.2", aliases: [] } },
		})),
		stopServiceContainer: vi.fn(async () => {}),
		removeServiceContainer: vi.fn(async () => {}),
		resolveImage: vi.fn(),
		prepareServiceNetwork: vi.fn(),
		inspectServiceNetwork: vi.fn(),
		listServiceContainers: vi.fn(),
		readServiceContainerLogs: vi.fn(),
	} satisfies IDockerService;
	const probe = vi.fn(async (_address: string, _port: number, _path: string) => true);
	const sleep = vi.fn(async (_ms: number) => {});
	return { docker, probe, sleep, containers: new DeploymentContainers(docker, probe, sleep) };
};

test("retirement preserves the resolved replacement image while removing predecessors", async () => {
	const f = fixture();
	await f.containers.retire("demo", ["old"], 45, "retirement failed", candidate.imageId);
	expect(f.docker.stopServiceContainer).toHaveBeenCalledWith("demo", "old", 45);
	expect(f.docker.removeServiceContainer).toHaveBeenCalledWith("demo", "old", candidate.imageId);
});

test("starts a resolved candidate with all workload options and returns its freshly observed address", async () => {
	const f = fixture();
	await expect(f.containers.startReady(candidate)).resolves.toEqual({ id: "new", address: "10.0.0.2" });
	expect(f.docker.createResourceContainer).toHaveBeenCalledWith({
		serviceId: "demo",
		resourceId: "app",
		revision: "rev",
		spec: "spec",
		instanceId: "attempt",
		imageId: "sha256:resolved",
		command: ["app"],
		env: { TOKEN: "resolved-secret" },
		volumes: candidate.resource.volumes,
		devices: candidate.resource.devices,
		supplementaryGroups: [109],
		selinuxLabeling: false,
		hostPorts: candidate.resource.hostPorts,
		limits: candidate.resource.limits,
	});
	expect(f.docker.startServiceContainer).toHaveBeenCalledWith("demo", "new");
	expect(f.docker.inspectServiceContainer).toHaveBeenCalledWith("demo", "new");
	expect(f.probe).toHaveBeenCalledWith("10.0.0.2", 8080, "/ready");
	expect(f.docker.resolveImage).not.toHaveBeenCalled();
	expect(f.docker.stopServiceContainer).not.toHaveBeenCalled();
});

test.each([undefined, null])(
	"disabled HTTP readiness still observes the network address: %s",
	async (healthcheckUrl) => {
		const f = fixture();
		await expect(
			f.containers.startReady({ ...candidate, resource: { ...candidate.resource, healthcheckUrl } }),
		).resolves.toEqual({ id: "new", address: "10.0.0.2" });
		expect(f.probe).not.toHaveBeenCalled();
	},
);

test("worker readiness uses its private port", async () => {
	const f = fixture();
	await f.containers.startReady({
		...candidate,
		resource: { type: "worker", image: "worker", healthcheckPort: 9090, healthcheckUrl: "/private" },
	});
	expect(f.probe).toHaveBeenCalledWith("10.0.0.2", 9090, "/private");
});

test("creation failure propagates without retiring any container", async () => {
	const f = fixture();
	const failure = new Error("create failed");
	f.docker.createResourceContainer.mockRejectedValue(failure);
	await expect(f.containers.startReady(candidate)).rejects.toBe(failure);
	expect(f.docker.startServiceContainer).not.toHaveBeenCalled();
	expect(f.docker.stopServiceContainer).not.toHaveBeenCalled();
});

test.each(["start", "inspect", "probe"] as const)("%s failure cleans only the failed candidate", async (stage) => {
	const f = fixture();
	const failure = new Error(`${stage} failed`);
	if (stage === "start") f.docker.startServiceContainer.mockRejectedValue(failure);
	if (stage === "inspect") f.docker.inspectServiceContainer.mockRejectedValue(failure);
	if (stage === "probe") f.probe.mockRejectedValue(failure);
	await expect(f.containers.startReady(candidate)).rejects.toBe(failure);
	expect(f.docker.stopServiceContainer).toHaveBeenCalledExactlyOnceWith("demo", "new", 60);
	expect(f.docker.removeServiceContainer).toHaveBeenCalledExactlyOnceWith("demo", "new");
});

test.each([
	["missing", "container is no longer present"],
	["stopped", "container is not running"],
	["addressless", "container has no address on the service network"],
	["probe", "HTTP health check on port 8080 at /ready did not pass"],
] as const)(
	"exhausted readiness cleans the %s candidate and preserves the last condition",
	async (condition, reason) => {
		const f = fixture();
		if (condition === "missing") f.docker.inspectServiceContainer.mockResolvedValue(null);
		if (condition === "stopped" || condition === "addressless")
			f.docker.inspectServiceContainer.mockResolvedValue({
				id: "new",
				imageId: candidate.imageId,
				running: condition !== "stopped",
				labels: {},
				networks: {},
			});
		f.probe.mockResolvedValue(false);
		await expect(f.containers.startReady(candidate)).rejects.toThrow(
			`Container readiness failed after 30 checks: ${reason}`,
		);
		expect(f.docker.inspectServiceContainer).toHaveBeenCalledTimes(30);
		expect(f.sleep).toHaveBeenCalledTimes(29);
		expect(f.sleep).toHaveBeenCalledWith(1000);
		expect(f.probe).toHaveBeenCalledTimes(condition === "probe" ? 30 : 0);
		expect(f.docker.removeServiceContainer).toHaveBeenCalledWith("demo", "new");
	},
);

test("readiness succeeds on check thirty using fresh observations", async () => {
	const f = fixture();
	let checks = 0;
	f.probe.mockImplementation(async () => ++checks === 30);
	await expect(f.containers.startReady(candidate)).resolves.toEqual({ id: "new", address: "10.0.0.2" });
	expect(f.docker.inspectServiceContainer).toHaveBeenCalledTimes(30);
	expect(f.sleep).toHaveBeenCalledTimes(29);
	expect(f.docker.stopServiceContainer).not.toHaveBeenCalled();
});

test.each(["stop", "remove"] as const)("startup plus %s failure preserves both errors", async (stage) => {
	const f = fixture();
	const startup = new Error("startup failed");
	const cleanup = new Error("cleanup failed");
	f.docker.startServiceContainer.mockRejectedValue(startup);
	if (stage === "stop") f.docker.stopServiceContainer.mockRejectedValue(cleanup);
	else f.docker.removeServiceContainer.mockRejectedValue(cleanup);
	await expect(f.containers.startReady(candidate)).rejects.toMatchObject({
		message: "Replacement startup and cleanup failed",
		errors: [startup, expect.objectContaining({ errors: [cleanup] })],
	});
	expect(f.docker.removeServiceContainer).toHaveBeenCalledTimes(stage === "stop" ? 0 : 1);
});
