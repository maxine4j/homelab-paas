import { expect, test } from "vitest";

import type { IDockerService } from "../../../docker/docker-service.ts";
import type { DockerContainerDetails, ServiceContainer } from "../../../docker/types.ts";
import { captureLogs } from "../../../util/test/logs.ts";
import type { IDeploymentService } from "../../deployment/deployment-service.ts";
import type { DeploymentRequest, DeploymentWebResource } from "../../deployment/strategy/types.ts";
import { WebResourceReconciler } from "./web-reconciler.ts";

const resource: DeploymentWebResource = { type: "web", image: "app:1", ingress: { public: true, port: 8080 } };
const input = { serviceId: "demo", resourceId: "app", revision: "rev", resource };

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
			healthcheckUrl: "/healthcheck",
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
	{ ...resource, ingress: { public: true, port: 9000 } },
	{ ...resource, healthcheckUrl: "/ready" },
	{ ...resource, termination: { timeoutSeconds: 60 } },
])("changed resource configuration requests a deployment: %j", async (changed) => {
	const f = fixture();
	await f.converge();
	await f.reconciler.reconcile({ ...input, resource: changed });
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
		["demo", { address: "10.0.0.2", port: 8080, healthcheckPath: "/healthcheck", public: true }],
	]);
});

test("unhealthy unchanged containers do not receive newly published routes", async () => {
	const f = fixture();
	await f.converge();
	f.setHealthy(false);
	await expect(f.reconciler.reconcile(input)).rejects.toThrow("readiness");
	expect(f.routes).toEqual([]);
	expect(f.requests).toEqual([]);
});
