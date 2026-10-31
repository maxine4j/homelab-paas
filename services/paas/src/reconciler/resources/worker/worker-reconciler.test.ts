import { expect, test, vi } from "vitest";

import type { IDockerService } from "../../../docker/docker-service.ts";
import type { ServiceContainer } from "../../../docker/types.ts";
import { captureLogs } from "../../../util/test/logs.ts";
import type { DeploymentWorkerResource } from "../../deployment/types.ts";
import type { IWorkerDeploymentService } from "../../deployment/worker-deployment-service.ts";
import { ResourceSpecification } from "../../resource-specification.ts";
import { WorkerResourceReconciler } from "./worker-reconciler.ts";

const resource: DeploymentWorkerResource = {
	type: "worker",
	image: "jobs:1",
	healthcheckPort: 9090,
	healthcheckUrl: "/healthcheck",
	replicas: 2,
};
const input = { serviceId: "demo", resourceId: "jobs", revision: "rev1", resource };

test("SELinux opt-out changes worker identity; explicit default preserves it", () => {
	const specification = new ResourceSpecification();
	const original = specification.get("jobs", resource);
	expect(specification.get("jobs", { ...resource, selinuxLabeling: true })).toBe(original);
	expect(specification.get("jobs", { ...resource, selinuxLabeling: false })).not.toBe(original);
});

test.each([undefined, null])("unchanged workers skip unconfigured HTTP checks: %s", async (healthcheckUrl) => {
	const f = fixture();
	const request = { ...input, resource: { ...resource, healthcheckUrl } };
	await f.reconciler.reconcile(request);
	const spec = f.deploy.mock.calls.at(-1)!.at(0)!.spec;
	f.setContainers(
		["one", "two"].map((id) => ({
			id,
			spec,
			state: "running",
			resourceId: "jobs",
			revision: "rev1",
			imageId: "image",
		})),
	);
	f.deploy.mockClear();
	f.probe.mockResolvedValue(false);
	await f.reconciler.reconcile(request);
	expect(f.probe).not.toHaveBeenCalled();
	expect(f.deploy).not.toHaveBeenCalled();
	await f.reconciler.reconcile({ ...input, resource: { ...resource, healthcheckUrl: "/healthcheck" } });
	expect(f.deploy).toHaveBeenCalledTimes(1);
});

test("volume ownership policy changes the worker specification and ignores read-only ownership", async () => {
	const f = fixture();
	const hash = async (readOnly: boolean, ownership?: false | { uid: number; gid: number }) => {
		await f.reconciler.reconcile({
			...input,
			resource: { ...resource, volumes: [{ hostPath: "/srv/data", mountPath: "/data", readOnly, ownership }] },
		});
		return f.deploy.mock.calls.at(-1)!.at(0)!.spec;
	};
	expect(await hash(false)).not.toBe(await hash(false, false));
	expect(await hash(true)).toBe(await hash(true, false));
	expect(await hash(false, { uid: 1000, gid: 1000 })).toBe(await hash(false));
	expect(await hash(false, { uid: 472, gid: 0 })).not.toBe(await hash(false));
	expect(await hash(false, { uid: 472, gid: 0 })).not.toBe(await hash(false, { uid: 473, gid: 0 }));
	expect(await hash(false, { uid: 472, gid: 0 })).not.toBe(await hash(false, { uid: 472, gid: 1 }));
	expect(await hash(true, { uid: 472, gid: 0 })).toBe(await hash(true));
});

test("forced reconciliation replaces healthy unchanged worker replicas", async () => {
	const f = fixture();
	await f.converge();
	await f.reconciler.reconcile({ ...input, force: true });
	expect(f.deploy).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
});

test("device paths, access and supplementary groups affect replacement while omitted fields retain identity", async () => {
	const f = fixture();
	const hash = async (settings: Partial<DeploymentWorkerResource>) => {
		await f.reconciler.reconcile({ ...input, resource: { ...resource, ...settings } });
		return f.deploy.mock.calls.at(-1)!.at(0)!.spec;
	};
	const device = { hostPath: "/dev/dri", mountPath: "/dev/dri" };
	const original = await hash({ devices: [device], supplementaryGroups: [44, 109] });
	expect(await hash({ devices: [{ ...device, permissions: "rwm" }], supplementaryGroups: [109, 44] })).toBe(original);
	for (const settings of [
		{ devices: [{ ...device, hostPath: "/dev/other" }], supplementaryGroups: [44, 109] },
		{ devices: [{ ...device, mountPath: "/dev/other" }], supplementaryGroups: [44, 109] },
		{ devices: [{ ...device, permissions: "rw" }], supplementaryGroups: [44, 109] },
		{ devices: [device], supplementaryGroups: [44] },
		{ devices: [device] },
		{ supplementaryGroups: [44, 109] },
		{},
	])
		expect(await hash(settings)).not.toBe(original);
	expect(await hash({ devices: [], supplementaryGroups: [] })).toBe(await hash({}));
});

const fixture = () => {
	let containers: ServiceContainer[] = [];
	const deploy = vi.fn<IWorkerDeploymentService["deploy"]>(async () => {});
	const probe = vi.fn(async () => true);
	const docker: IDockerService = {
		listServiceContainers: vi.fn(async () => containers),
		inspectServiceNetwork: vi.fn(async () => ({
			id: "n",
			name: "network",
			driver: "bridge",
			labels: {},
			containerIds: containers.map(({ id }) => id),
		})),
		inspectServiceContainer: vi.fn(async (_service, id) => ({
			id,
			imageId: "image",
			running: true,
			labels: {},
			networks: { network: { address: id, aliases: [] } },
		})),
		prepareServiceNetwork: vi.fn(async () => {}),
		resolveImage: vi.fn(),
		createResourceContainer: vi.fn(),
		startServiceContainer: vi.fn(),
		stopServiceContainer: vi.fn(),
		removeServiceContainer: vi.fn(),
		readServiceContainerLogs: vi.fn(),
	};
	const reconciler = new WorkerResourceReconciler(new ResourceSpecification(), docker, { deploy }, probe);
	return {
		reconciler,
		docker,
		deploy,
		probe,
		setContainers(value: ServiceContainer[]) {
			containers = value;
		},
		async converge() {
			await reconciler.reconcile(input);
			const request = vi.mocked(deploy).mock.calls.at(-1)!.at(0)!;
			containers = ["one", "two"].map((id) => ({
				id,
				spec: request.spec,
				state: "running",
				resourceId: "jobs",
				revision: "rev1",
				imageId: "image",
			}));
			deploy.mockClear();
			return containers;
		},
	};
};

test("worker drift delegates deployment and unchanged commits only probe private endpoints", async () => {
	const f = fixture();
	await f.converge();
	const logs = captureLogs();
	try {
		await f.reconciler.reconcile({ ...input, revision: "rev2" });
	} finally {
		logs.restore();
	}
	expect(f.deploy).not.toHaveBeenCalled();
	expect(f.probe.mock.calls).toEqual([
		["one", 9090, "/healthcheck"],
		["two", 9090, "/healthcheck"],
	]);
	expect(f.docker.prepareServiceNetwork).toHaveBeenCalledWith("demo");
	expect(logs.lines).toEqual([]);
});

test.each(["missing", "stopped", "duplicate"])("repairs a %s replica", async (drift) => {
	const f = fixture();
	const containers = await f.converge();
	if (drift === "missing") f.setContainers(containers.slice(0, 1));
	if (drift === "stopped") containers.at(0)!.state = "exited";
	if (drift === "duplicate") f.setContainers([...containers, { ...containers.at(0)!, id: "extra" }]);
	await f.reconciler.reconcile(input);
	expect(f.deploy).toHaveBeenCalledTimes(1);
});

test("a failed private health check prevents reporting a converged worker as ready", async () => {
	const f = fixture();
	await f.converge();
	f.probe.mockResolvedValue(false);
	await expect(f.reconciler.reconcile(input)).rejects.toThrow(
		"Worker readiness failed: private health check on port 9090 at /healthcheck did not pass",
	);
	expect(f.deploy).not.toHaveBeenCalled();
});

test.each<Partial<DeploymentWorkerResource>>([
	{ hostPorts: [{ protocol: "tcp", hostPort: 18080, containerPort: 8080, bindAddress: "127.0.0.1" }] },
	{ image: "jobs:2" },
	{ command: ["run"] },
	{ env: [{ name: "TOKEN", value: "secret" }] },
	{ volumes: [{ hostPath: "/srv/data", mountPath: "/data" }] },
	{ limits: { cpus: 0.5 } },
	{ limits: { memoryMiB: 256 } },
	{ replicas: 3 },
	{ rolloutStrategy: "surge" },
	{ termination: { timeoutSeconds: 60 } },
	{ healthcheckPort: 9091 },
	{ healthcheckUrl: "/ready" },
])("configuration changes replace workers: %j", async (change) => {
	const f = fixture();
	await f.converge();
	await f.reconciler.reconcile({ ...input, resource: { ...resource, ...change } });
	expect(f.deploy).toHaveBeenCalledTimes(1);
});

test("every host binding field and binding removal change the worker specification", async () => {
	const f = fixture();
	const binding = { protocol: "tcp" as const, hostPort: 18080, containerPort: 8080, bindAddress: "127.0.0.1" };
	const hash = async (hostPorts: DeploymentWorkerResource["hostPorts"]) => {
		await f.reconciler.reconcile({ ...input, resource: { ...resource, replicas: 1, hostPorts } });
		return f.deploy.mock.calls.at(-1)!.at(0)!.spec;
	};
	const original = await hash([binding]);
	for (const changed of [
		{ ...binding, protocol: "udp" as const },
		{ ...binding, hostPort: 18081 },
		{ ...binding, containerPort: 8081 },
		{ ...binding, bindAddress: "::1" },
	])
		expect(await hash([changed])).not.toBe(original);
	expect(await hash(undefined)).not.toBe(original);
	expect(await hash([])).toBe(await hash(undefined));
});

test("environment ordering and explicit defaults keep the worker fingerprint stable", async () => {
	const f = fixture();
	const hash = async (value: DeploymentWorkerResource) => {
		await f.reconciler.reconcile({ ...input, resource: value });
		return f.deploy.mock.calls.at(-1)!.at(0)!.spec;
	};
	const first = await hash({
		...resource,
		env: [
			{ name: "B", value: "b" },
			{ name: "A", value: "secret" },
		],
	});
	const second = await hash({
		...resource,
		healthcheckUrl: "/healthcheck",
		rolloutStrategy: "recreate",
		termination: { timeoutSeconds: 30 },
		env: [
			{ name: "A", value: "secret" },
			{ name: "B", value: "b" },
		],
	});
	expect(first).toBe(second);
	expect(first).toMatch(/^[a-f0-9]{64}$/);
});
