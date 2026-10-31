import { expect, test, vi } from "vitest";

import type { IDockerService } from "../../../docker/docker-service.ts";
import type { DockerContainerDetails, ServiceContainer } from "../../../docker/types.ts";
import { captureLogs } from "../../../util/test/logs.ts";
import type { IDeploymentService } from "../../deployment/deployment-service.ts";
import type { DeploymentRequest, DeploymentWebResource } from "../../deployment/strategy/types.ts";
import { WebResourceReconciler } from "./web-reconciler.ts";

const resource: DeploymentWebResource = { type: "web", image: "app:1", ingress: { public: true, port: 8080 } };
const input = { serviceId: "demo", resourceId: "app", revision: "rev", resource };

test.each([undefined, null])("unchanged web containers skip unconfigured HTTP checks: %s", async (healthcheckUrl) => {
	const f = fixture();
	await f.converge();
	const probe = vi.fn(async () => false);
	const reconciler = new WebResourceReconciler(
		f.docker,
		{
			deploy: async () => {
				throw new Error("unexpected deployment");
			},
		},
		{ routeTo: async () => {}, withdraw: async () => {} },
		probe,
	);
	await reconciler.reconcile({ ...input, resource: { ...resource, healthcheckUrl } });
	expect(probe).not.toHaveBeenCalled();
});

test("enabling a web HTTP check changes its specification", async () => {
	const f = fixture();
	await f.converge();
	const before = f.requests.length;
	await f.reconciler.reconcile({ ...input, resource: { ...resource, healthcheckUrl: "/healthcheck" } });
	expect(f.requests).toHaveLength(before + 1);
});

test("volume ownership policy changes the web specification and ignores read-only ownership", async () => {
	const f = fixture();
	const hash = async (readOnly: boolean, ownership?: false | { uid: number; gid: number }) => {
		await f.reconciler.reconcile({
			...input,
			resource: { ...resource, volumes: [{ hostPath: "/srv/data", mountPath: "/data", readOnly, ownership }] },
		});
		return f.requests.at(-1)!.spec;
	};
	expect(await hash(false)).not.toBe(await hash(false, false));
	expect(await hash(true)).toBe(await hash(true, false));
	expect(await hash(false, { uid: 1000, gid: 1000 })).toBe(await hash(false));
	expect(await hash(false, { uid: 472, gid: 0 })).not.toBe(await hash(false));
	expect(await hash(false, { uid: 472, gid: 0 })).not.toBe(await hash(false, { uid: 473, gid: 0 }));
	expect(await hash(false, { uid: 472, gid: 0 })).not.toBe(await hash(false, { uid: 472, gid: 1 }));
	expect(await hash(true, { uid: 472, gid: 0 })).toBe(await hash(true));
});

test("forced reconciliation replaces a healthy unchanged web container", async () => {
	const f = fixture();
	const containers = await f.converge();
	const before = f.requests.length;
	await f.reconciler.reconcile({ ...input, force: true });
	expect(f.requests).toHaveLength(before + 1);
	expect(f.requests.at(-1)?.spec).toBe(containers.at(0)?.spec);
});

test("device paths, access and supplementary groups affect replacement while omitted fields retain identity", async () => {
	const f = fixture();
	const hash = async (settings: Partial<DeploymentWebResource>) => {
		await f.reconciler.reconcile({ ...input, resource: { ...resource, ...settings } });
		return f.requests.at(-1)!.spec;
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

test("every host binding field and binding removal change the web specification", async () => {
	const f = fixture();
	const binding = { protocol: "tcp" as const, hostPort: 18080, containerPort: 8080, bindAddress: "127.0.0.1" };
	const hash = async (hostPorts: DeploymentWebResource["hostPorts"]) => {
		await f.reconciler.reconcile({ ...input, resource: { ...resource, hostPorts } });
		return f.requests.at(-1)!.spec;
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

test("logs drift with an action and stays silent once converged", async () => {
	const f = fixture();
	const capture = captureLogs();
	try {
		await f.converge();
		await f.reconciler.reconcile(input);
	} finally {
		capture.restore();
	}
	expect(capture.lines).toHaveLength(1);
	expect(JSON.parse(capture.lines.at(0)!)).toMatchObject({
		event: "resource.drift",
		reason: "missing",
		serviceId: "demo",
		resourceId: "app",
		strategy: "recreate",
	});
});

function fixture() {
	const requests: DeploymentRequest[] = [];
	const queries: unknown[] = [];
	let containers: ServiceContainer[] = [];
	const routes: unknown[] = [];
	let healthy = true;
	const networking = {
		async routeTo(...args: unknown[]) {
			routes.push(args);
		},
		async withdraw() {},
	};
	const docker: IDockerService = {
		async readServiceContainerLogs() {
			return "";
		},
		async listServiceContainers(...args) {
			queries.push(args);
			return containers;
		},
		async inspectServiceNetwork() {
			return {
				id: "n",
				name: "network",
				driver: "bridge",
				labels: {},
				containerIds: containers.map((c) => c.id),
			};
		},
		async inspectServiceContainer(_serviceId, containerId) {
			return {
				id: containerId,
				imageId: "image",
				running: true,
				labels: {},
				networks: { network: { address: "10.0.0.2", aliases: [] } },
			};
		},
		async prepareServiceNetwork() {
			queries.push("prepare-network");
		},
		async resolveImage() {
			throw new Error("reconciler must not resolve images");
		},
		async createResourceContainer() {
			throw new Error("reconciler must not create containers");
		},
		async startServiceContainer() {
			throw new Error("reconciler must not start containers");
		},
		async stopServiceContainer() {
			throw new Error("reconciler must not stop containers");
		},
		async removeServiceContainer() {
			throw new Error("reconciler must not remove containers");
		},
	};
	const deployment: IDeploymentService = {
		async deploy(request) {
			requests.push(request);
		},
	};
	return {
		docker,
		requests,
		queries,
		routes,
		setHealthy(value: boolean) {
			healthy = value;
		},
		reconciler: new WebResourceReconciler(docker, deployment, networking, async () => healthy),
		setContainers(value: ServiceContainer[]) {
			containers = value;
		},
		async converge() {
			await this.reconciler.reconcile(input);
			const request = requests.at(-1);
			if (!request) throw new Error("Expected deployment");
			containers = [
				{
					id: "c",
					imageId: "image",
					resourceId: "app",
					revision: "old-rev",
					spec: request.spec,
					state: "running",
				},
			];
			requests.length = 0;
			return containers;
		},
	};
}

test("observes service-scoped state and delegates a missing resource without Docker mutations", async () => {
	const f = fixture();
	await f.reconciler.reconcile(input);
	expect(f.queries).toEqual([["demo", "app"]]);
	expect(f.requests).toEqual([{ ...input, spec: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
});

test("an unchanged running resource does not redeploy when only source revision changes", async () => {
	const f = fixture();
	await f.converge();
	await f.reconciler.reconcile({ ...input, revision: "new-rev" });
	expect(f.requests).toEqual([]);
});

test("primary selection changes routing without replacing the workload", async () => {
	const f = fixture();
	await f.converge();
	await f.reconciler.reconcile({ ...input, resource: { ...resource, primary: false } });
	expect(f.requests).toEqual([]);
	expect(f.routes.at(-1)).toEqual(["app.demo", expect.objectContaining({ primary: false })]);
});

test("replaces a legacy bind-mounted workload once to apply shared SELinux labels", async () => {
	const f = fixture();
	// Persisted fingerprint produced before shared SELinux bind labels were introduced.
	const legacySpec = "4271e06ed751e6741fdf3e8c5fb7697fd37772397d59c1c18dfcce572ab0aa68";
	f.setContainers([
		{ id: "c", imageId: "image", resourceId: "app", revision: "rev", spec: legacySpec, state: "running" },
	]);
	const mounted = { ...input, resource: { ...resource, volumes: [{ hostPath: "/srv/data", mountPath: "/data" }] } };
	await f.reconciler.reconcile(mounted);
	expect(f.requests).toHaveLength(1);
	const desired = f.requests.at(0)!;
	expect(desired.spec).not.toBe(legacySpec);
	f.setContainers([
		{
			id: "replacement",
			imageId: "image",
			resourceId: "app",
			revision: "rev",
			spec: desired.spec,
			state: "running",
		},
	]);
	f.requests.length = 0;
	await f.reconciler.reconcile(mounted);
	expect(f.requests).toEqual([]);
});

test("equivalent defaults and environment ordering produce the same desired state", async () => {
	const f = fixture();
	await f.reconciler.reconcile({
		...input,
		resource: {
			...resource,
			env: [
				{ name: "B", value: "2" },
				{ name: "A", value: "1" },
			],
		},
	});
	expect(f.requests).toHaveLength(1);
	const spec = f.requests.at(-1)?.spec ?? "";
	f.setContainers([{ id: "c", imageId: "image", resourceId: "app", revision: "old", spec, state: "running" }]);
	f.requests.length = 0;
	await f.reconciler.reconcile({
		...input,
		resource: {
			...resource,
			replicas: 1,
			rolloutStrategy: "recreate",
			termination: { timeoutSeconds: 30 },
			healthcheckUrl: null,
			env: [
				{ name: "A", value: "1" },
				{ name: "B", value: "2" },
			],
		},
	});
	expect(f.requests).toEqual([]);
});

test.each<DeploymentWebResource>([
	{ ...resource, image: "app:2" },
	{ ...resource, command: ["node", "new.js"] },
	{ ...resource, env: [{ name: "TOKEN", value: "secret" }] },
	{ ...resource, volumes: [{ hostPath: "/srv/data", mountPath: "/data" }] },
	{ ...resource, limits: { cpus: 0.5 } },
	{ ...resource, limits: { memoryMiB: 256 } },
	{ ...resource, ingress: { public: true, port: 9000 } },
	{ ...resource, healthcheckUrl: "/ready" },
	{ ...resource, termination: { timeoutSeconds: 60 } },
])("changed resource configuration requests a deployment: %j", async (changed) => {
	const f = fixture();
	await f.converge();
	await f.reconciler.reconcile({ ...input, resource: changed });
	expect(f.requests).toHaveLength(1);
});

test("changed resolved secret values change the specification without exposing them in labels or logs", async () => {
	const f = fixture();
	const capture = captureLogs();
	try {
		await f.reconciler.reconcile({
			...input,
			resource: { ...resource, env: [{ name: "TOKEN", value: "first-secret" }] },
		});
		const spec = f.requests.at(-1)!.spec;
		f.setContainers([{ id: "c", imageId: "image", resourceId: "app", revision: "rev", spec, state: "running" }]);
		f.requests.length = 0;
		await f.reconciler.reconcile({
			...input,
			resource: { ...resource, env: [{ name: "TOKEN", value: "second-secret" }] },
		});
		expect(f.requests).toHaveLength(1);
		expect(f.requests.at(0)?.spec).not.toBe(spec);
		expect(capture.lines.join("")).not.toMatch(/first-secret|second-secret/);
	} finally {
		capture.restore();
	}
});

test.each([
	{ volumes: [{ hostPath: "/srv/other", mountPath: "/data" }] },
	{ hostPorts: [{ protocol: "tcp" as const, hostPort: 18080, containerPort: 8080, bindAddress: "127.0.0.1" }] },
	{ volumes: [{ hostPath: "/srv/data", mountPath: "/other" }] },
	{ volumes: [{ hostPath: "/srv/data", mountPath: "/data", readOnly: true }] },
	{ limits: { cpus: 1, memoryMiB: 256 } },
	{ limits: { cpus: 0.5, memoryMiB: 512 } },
])("changed mount or limit settings trigger replacement: %j", async (changed) => {
	const f = fixture();
	const configured = {
		...resource,
		volumes: [{ hostPath: "/srv/data", mountPath: "/data" }],
		limits: { cpus: 0.5, memoryMiB: 256 },
	};
	await f.reconciler.reconcile({ ...input, resource: configured });
	const spec = f.requests.at(-1)!.spec;
	f.setContainers([{ id: "c", imageId: "image", resourceId: "app", revision: "rev", spec, state: "running" }]);
	f.requests.length = 0;
	await f.reconciler.reconcile({ ...input, resource: { ...configured, ...changed } });
	expect(f.requests).toHaveLength(1);
});

test.each(["exited", "dead", "paused", "restarting"])("non-running resources require deployment: %s", async (state) => {
	const f = fixture();
	const containers = await f.converge();
	f.setContainers(containers.map((c) => ({ ...c, state })));
	await f.reconciler.reconcile(input);
	expect(f.requests).toHaveLength(1);
});

test("duplicate containers require reconciliation even when one matches", async () => {
	const f = fixture();
	const containers = await f.converge();
	f.setContainers([...containers, ...containers.map((c) => ({ ...c, id: "extra" }))]);
	await f.reconciler.reconcile(input);
	expect(f.requests).toHaveLength(1);
});

test.each(["network", "container", "running", "address", "attachment"])(
	"observed drift requires deployment: %s",
	async (drift) => {
		const f = fixture();
		await f.converge();
		if (drift === "network") f.docker.inspectServiceNetwork = async () => null;
		if (drift === "attachment")
			f.docker.inspectServiceNetwork = async () => ({
				id: "n",
				name: "network",
				driver: "bridge",
				labels: {},
				containerIds: [],
			});
		if (["container", "running", "address"].includes(drift))
			f.docker.inspectServiceContainer = async (): Promise<DockerContainerDetails | null> =>
				drift === "container"
					? null
					: {
							id: "c",
							imageId: "image",
							running: drift !== "running",
							labels: {},
							networks: drift === "address" ? {} : { network: { address: "10.0.0.2", aliases: [] } },
						};
		await f.reconciler.reconcile(input);
		expect(f.requests).toHaveLength(1);
	},
);

test("observation failures do not deploy and deployment failures propagate", async () => {
	const f = fixture();
	f.docker.listServiceContainers = async () => {
		throw new Error("observation failed");
	};
	await expect(f.reconciler.reconcile(input)).rejects.toThrow("observation failed");
	expect(f.requests).toEqual([]);
	const reconciler = new WebResourceReconciler(
		fixture().docker,
		{
			async deploy() {
				throw new Error("deployment failed");
			},
		},
		{
			async routeTo() {},
			async withdraw() {},
		},
		async () => true,
	);
	await expect(reconciler.reconcile(input)).rejects.toThrow("deployment failed");
});

test("repairs network attachment and republishes ready unchanged endpoints without deployment", async () => {
	const f = fixture();
	await f.converge();
	await f.reconciler.reconcile(input);
	expect(f.requests).toEqual([]);
	expect(f.queries).toContain("prepare-network");
	expect(f.routes).toEqual([
		["app.demo", { address: "10.0.0.2", port: 8080, healthcheckPath: undefined, public: true, primary: true }],
	]);
});

test("unhealthy unchanged containers do not receive newly published routes", async () => {
	const f = fixture();
	const checked = { ...input, resource: { ...resource, healthcheckUrl: "/ready" } };
	await f.reconciler.reconcile(checked);
	const spec = f.requests.at(-1)!.spec;
	f.setContainers([{ id: "c", imageId: "image", resourceId: "app", revision: "rev", spec, state: "running" }]);
	f.requests.length = 0;
	f.setHealthy(false);
	await expect(f.reconciler.reconcile(checked)).rejects.toThrow(
		"Container readiness failed: HTTP health check on port 8080 at /ready did not pass",
	);
	expect(f.routes).toEqual([]);
	expect(f.requests).toEqual([]);
});
