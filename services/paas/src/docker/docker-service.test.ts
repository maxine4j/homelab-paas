import { expect, test } from "vitest";

import { testConfig } from "../util/test/config.ts";
import { DockerClientError } from "./docker-client.ts";
import type { IDockerClient } from "./docker-client.ts";
import { DockerService, DockerServiceError } from "./docker-service.ts";
import type { DockerContainer, DockerContainerDetails, DockerNetwork } from "./types.ts";

const ownership = { "homelab-paas.cluster": "local", "homelab-paas.service": "demo" };

test("discovers and inspects only the unique running control-plane container in this cluster", async () => {
	const labels = { "homelab-paas.cluster": "local", "homelab-paas.role": "control-plane" };
	const f = fixture({
		listContainers: async (query) => {
			expect(query).toEqual({ all: false, labels });
			return [{ ...container, labels }];
		},
		inspectContainer: async () => ({ ...details, running: true, labels }),
	});
	expect(await f.service.inspectControlPlaneContainer()).toMatchObject({ id: "c", labels });
	for (const candidates of [
		[],
		[container],
		[
			{ ...container, labels },
			{ ...container, id: "other", labels },
		],
	]) {
		await expect(
			fixture({ listContainers: async () => candidates }).service.inspectControlPlaneContainer(),
		).rejects.toThrow(DockerServiceError);
	}
	for (const inspected of [
		null,
		details,
		{ ...details, labels, running: false },
		{ ...details, labels, running: true, id: "other" },
	]) {
		await expect(
			fixture({
				listContainers: async () => [{ ...container, labels }],
				inspectContainer: async () => inspected,
			}).service.inspectControlPlaneContainer(),
		).rejects.toThrow(DockerServiceError);
	}
});

test("prepares only writable opted-in mounts using the uniquely identified control-plane image before creating workloads", async () => {
	const f = fixture({
		async listContainers() {
			return [
				{
					...container,
					imageId: "controller-image",
					labels: { "homelab-paas.cluster": "local", "homelab-paas.role": "control-plane" },
				},
			];
		},
	});
	await f.service.createResourceContainer({
		serviceId: "demo",
		resourceId: "app",
		revision: "rev",
		spec: "spec",
		imageId: "image",
		volumes: [
			{ hostPath: "/srv/data", mountPath: "/data" },
			{ hostPath: "/srv/media", mountPath: "/media", readOnly: true },
			{ hostPath: "/srv/custom", mountPath: "/custom", ownership: false },
			{ hostPath: "/srv/grafana", mountPath: "/grafana", ownership: { uid: 472, gid: 0 } },
			{ hostPath: "/srv/plugins", mountPath: "/plugins", ownership: { uid: 472, gid: 0 } },
			{ hostPath: "/srv/config", mountPath: "/config", readOnly: true, ownership: { uid: 472, gid: 0 } },
			{ hostPath: "/srv/data", mountPath: "/data-again", ownership: { uid: 1000, gid: 1000 } },
		],
	});
	expect(f.calls.filter(({ operation }) => operation !== "listContainers").map(({ operation }) => operation)).toEqual(
		["prepareVolumeOwnership", "prepareVolumeOwnership", "createContainer"],
	);
	expect(f.calls.find(({ operation }) => operation === "prepareVolumeOwnership")?.args).toEqual([
		"controller-image",
		["/srv/data"],
		{ "homelab-paas.cluster": "local", "homelab-paas.owner-service": "demo", "homelab-paas.role": "volume-init" },
		"1000:1000",
	]);
	expect(f.calls.filter(({ operation }) => operation === "prepareVolumeOwnership").at(1)?.args).toEqual([
		"controller-image",
		["/srv/grafana", "/srv/plugins"],
		{ "homelab-paas.cluster": "local", "homelab-paas.owner-service": "demo", "homelab-paas.role": "volume-init" },
		"472:0",
	]);
});

test("preserves descriptor mounts and resource limits for the Docker adapter", async () => {
	const f = fixture();
	const volumes = [{ hostPath: "/mnt/external drive", mountPath: "/data", readOnly: true }];
	const devices = [{ hostPath: "/dev/dri", mountPath: "/dev/dri" }];
	const supplementaryGroups = [109];
	const limits = { cpus: 0.5, memoryMiB: 512 };
	const hostPorts = [{ protocol: "udp" as const, containerPort: 8080, hostPort: 18080, bindAddress: "::1" }];
	await f.service.createResourceContainer({
		serviceId: "demo",
		resourceId: "app",
		revision: "rev",
		spec: "spec",
		imageId: "image",
		volumes,
		devices,
		supplementaryGroups,
		hostPorts,
		limits,
	});
	expect(f.calls.find(({ operation }) => operation === "createContainer")?.args).toEqual([
		expect.objectContaining({ volumes, limits, hostPorts, devices, supplementaryGroups }),
	]);
});
const identity = {
	...ownership,
	"homelab-paas.resource": "app",
	"homelab-paas.revision": "rev",
	"homelab-paas.spec": "abcdef0123456789",
};
const container: DockerContainer = {
	id: "c",
	names: ["/arbitrary"],
	imageId: "sha256:a",
	state: "exited",
	labels: identity,
};
const details: DockerContainerDetails = {
	id: "c",
	imageId: "sha256:a",
	running: false,
	labels: identity,
	networks: {},
};
const network: DockerNetwork = {
	id: "n",
	name: "paas-local-demo",
	driver: "bridge",
	labels: ownership,
	containerIds: [],
};

function fixture(overrides: Partial<IDockerClient> = {}) {
	const calls: { operation: string; args: unknown[] }[] = [];
	function record(operation: string, ...args: unknown[]) {
		calls.push({ operation, args });
	}
	const client: IDockerClient = {
		async prepareVolumeOwnership(...args) {
			record("prepareVolumeOwnership", ...args);
		},
		async readContainerLogs() {
			return "";
		},
		async createNetwork(options) {
			record("createNetwork", options);
			return "n";
		},
		async inspectNetwork(id) {
			record("inspectNetwork", id);
			return network;
		},
		async connectNetwork(...args) {
			record("connectNetwork", ...args);
		},
		async disconnectNetwork(...args) {
			record("disconnectNetwork", ...args);
		},
		async removeNetwork(...args) {
			record("removeNetwork", ...args);
		},
		async listContainers(options) {
			record("listContainers", options);
			return [container];
		},
		async inspectContainer(id) {
			record("inspectContainer", id);
			return details;
		},
		async createContainer(options) {
			record("createContainer", options);
			return "new";
		},
		async startContainer(...args) {
			record("startContainer", ...args);
		},
		async stopContainer(...args) {
			record("stopContainer", ...args);
		},
		async removeContainer(...args) {
			record("removeContainer", ...args);
		},
		async inspectImage(reference) {
			record("inspectImage", reference);
			return { id: "sha256:a" };
		},
		async pullImage(reference) {
			record("pullImage", reference);
		},
		...overrides,
	};
	return { service: new DockerService(client, testConfig({ metadata: { clusterId: "local" } })), calls };
}

test("queries all containers by cluster and service, optionally narrowing to a resource", async () => {
	const f = fixture();
	expect(await f.service.listServiceContainers("demo")).toEqual([
		{ id: "c", imageId: "sha256:a", resourceId: "app", revision: "rev", spec: "abcdef0123456789", state: "exited" },
	]);
	await f.service.listServiceContainers("demo", "app");
	expect(f.calls).toEqual([
		{ operation: "listContainers", args: [{ all: true, labels: ownership }] },
		{
			operation: "listContainers",
			args: [{ all: true, labels: { ...ownership, "homelab-paas.resource": "app" } }],
		},
	]);
});

test.each(["homelab-paas.resource", "homelab-paas.revision", "homelab-paas.spec"])(
	"rejects missing container identity: %s",
	async (key) => {
		const labels = { ...identity, [key]: "" };
		await expect(
			fixture({
				async listContainers() {
					return [{ ...container, labels }];
				},
			}).service.listServiceContainers("demo"),
		).rejects.toEqual(new DockerServiceError("invalid-identity"));
	},
);

test("does not trust a container outside the requested ownership or resource scope", async () => {
	for (const labels of [
		{ ...identity, "homelab-paas.cluster": "other" },
		{ ...identity, "homelab-paas.service": "other" },
	]) {
		await expect(
			fixture({
				async listContainers() {
					return [{ ...container, labels }];
				},
			}).service.listServiceContainers("demo"),
		).rejects.toMatchObject({ kind: "ownership" });
	}
	await expect(fixture().service.listServiceContainers("demo", "different")).rejects.toMatchObject({
		kind: "invalid-identity",
	});
});

test("inspects owned containers and explicitly reports absence", async () => {
	expect(await fixture().service.inspectServiceContainer("demo", "c")).toEqual(details);
	expect(
		await fixture({
			async inspectContainer() {
				return null;
			},
		}).service.inspectServiceContainer("demo", "c"),
	).toBeNull();
	await expect(fixture().service.inspectServiceContainer("other", "c")).rejects.toMatchObject({ kind: "ownership" });
});

test("inspects service networks by convention and verifies ownership labels", async () => {
	const f = fixture();
	expect(await f.service.inspectServiceNetwork("demo")).toEqual(network);
	expect(f.calls).toEqual([{ operation: "inspectNetwork", args: ["paas-local-demo"] }]);
	expect(
		await fixture({
			async inspectNetwork() {
				return null;
			},
		}).service.inspectServiceNetwork("demo"),
	).toBeNull();
	await expect(
		fixture({
			async inspectNetwork() {
				return { ...network, labels: {} };
			},
		}).service.inspectServiceNetwork("demo"),
	).rejects.toMatchObject({ kind: "ownership" });
});

test("prepares a missing service network and attaches the cluster's infrastructure containers", async () => {
	const f = fixture({
		async inspectNetwork() {
			return null;
		},
		async listContainers(options) {
			const role = options?.labels?.["homelab-paas.role"];
			return [
				{
					...container,
					id: `${role}-id`,
					labels: { "homelab-paas.cluster": "local", "homelab-paas.role": role ?? "" },
				},
			];
		},
	});
	await f.service.prepareServiceNetwork("demo");
	expect(f.calls).toContainEqual({
		operation: "createNetwork",
		args: [{ name: "paas-local-demo", driver: "bridge", labels: ownership }],
	});
	expect(f.calls.filter((call) => call.operation === "connectNetwork")).toEqual([
		{ operation: "connectNetwork", args: ["n", "control-plane-id"] },
		{ operation: "connectNetwork", args: ["n", "envoy-id"] },
	]);
});

test("reuses owned networks and skips existing infrastructure attachments", async () => {
	const filters: unknown[] = [];
	const f = fixture({
		async inspectNetwork() {
			return { ...network, containerIds: ["control-plane-id", "envoy-id"] };
		},
		async listContainers(options) {
			filters.push(options);
			const role = options?.labels?.["homelab-paas.role"] ?? "";
			return [
				{
					...container,
					id: `${role}-id`,
					labels: { "homelab-paas.cluster": "local", "homelab-paas.role": role },
				},
			];
		},
	});
	await f.service.prepareServiceNetwork("demo");
	expect(f.calls.filter((call) => ["createNetwork", "connectNetwork"].includes(call.operation))).toEqual([]);
	expect(filters).toEqual(
		["control-plane", "envoy"].map((role) => ({
			all: true,
			labels: { "homelab-paas.cluster": "local", "homelab-paas.role": role },
		})),
	);
});

test.each([0, 2])("rejects ambiguous infrastructure before creating or attaching anything: %s peers", async (count) => {
	const f = fixture({
		async listContainers() {
			return Array.from({ length: count }, () => container);
		},
		async inspectNetwork() {
			return null;
		},
	});
	await expect(f.service.prepareServiceNetwork("demo")).rejects.toMatchObject({ kind: "infrastructure" });
	expect(f.calls.filter((call) => ["createNetwork", "connectNetwork"].includes(call.operation))).toEqual([]);
});

test("rejects infrastructure outside the cluster or requested role", async () => {
	const f = fixture();
	await expect(f.service.prepareServiceNetwork("demo")).rejects.toMatchObject({ kind: "infrastructure" });
	expect(f.calls.some((call) => call.operation === "connectNetwork")).toBe(false);
});

test("creates a resource container with platform naming, labels and resource alias", async () => {
	const f = fixture();
	expect(
		await f.service.createResourceContainer({
			serviceId: "demo",
			resourceId: "app",
			revision: "rev",
			spec: "abcdef0123456789",
			imageId: "sha256:a",
			command: ["node", "app.js"],
			env: { FOO: "bar" },
		}),
	).toBe("new");
	expect(f.calls).toEqual([
		{
			operation: "createContainer",
			args: [
				{
					name: "paas-local-demo-app-abcdef012345",
					image: "sha256:a",
					command: ["node", "app.js"],
					env: { FOO: "bar" },
					labels: identity,
					network: "paas-local-demo",
					aliases: ["app"],
					restartPolicy: "unless-stopped",
				},
			],
		},
	]);
});

test("instance identities allow overlapping containers with the same resource specification", async () => {
	const f = fixture();
	for (const instanceId of ["attempt-1", "attempt-2"]) {
		await f.service.createResourceContainer({
			serviceId: "demo",
			resourceId: "app",
			revision: "rev",
			spec: "abcdef0123456789",
			imageId: "image",
			instanceId,
		});
	}
	expect(f.calls.map((call) => call.args)).toMatchObject([
		[{ name: "paas-local-demo-app-abcdef012345-attempt-1", labels: identity }],
		[{ name: "paas-local-demo-app-abcdef012345-attempt-2", labels: identity }],
	]);
});

test("starts, stops and removes only containers owned by the requested service", async () => {
	const f = fixture();
	await f.service.startServiceContainer("demo", "c");
	await f.service.stopServiceContainer("demo", "c", 45);
	await f.service.removeServiceContainer("demo", "c");
	expect(f.calls.filter((call) => call.operation !== "inspectContainer")).toEqual([
		{ operation: "startContainer", args: ["c"] },
		{ operation: "stopContainer", args: ["c", 45] },
		{ operation: "removeContainer", args: ["c"] },
	]);
	await expect(f.service.startServiceContainer("other", "c")).rejects.toMatchObject({ kind: "ownership" });
	await expect(f.service.stopServiceContainer("other", "c", 30)).rejects.toMatchObject({ kind: "ownership" });
	await expect(f.service.removeServiceContainer("other", "c")).rejects.toMatchObject({ kind: "ownership" });
	expect(f.calls.filter((call) => call.operation !== "inspectContainer")).toHaveLength(3);
});

test("missing containers make start fail but stop and removal succeed", async () => {
	const f = fixture({
		async inspectContainer() {
			return null;
		},
	});
	await expect(f.service.startServiceContainer("demo", "c")).rejects.toMatchObject({ kind: "not-found" });
	await f.service.stopServiceContainer("demo", "c", 30);
	await f.service.removeServiceContainer("demo", "c");
	expect(f.calls).toEqual([]);
});

test("stop and removal tolerate disappearance after inspection but propagate other failures", async () => {
	const f = fixture({
		async stopContainer() {
			throw new DockerClientError("not-found");
		},
		async removeContainer() {
			throw new DockerClientError("not-found");
		},
	});
	await f.service.stopServiceContainer("demo", "c", 30);
	await f.service.removeServiceContainer("demo", "c");
	await expect(
		fixture({
			async removeContainer() {
				throw new DockerClientError("conflict");
			},
		}).service.removeServiceContainer("demo", "c"),
	).rejects.toMatchObject({ kind: "conflict" });
});

test("uses a preloaded local image without pulling", async () => {
	const f = fixture();
	expect(await f.service.resolveImage("app:local")).toBe("sha256:a");
	expect(f.calls).toEqual([{ operation: "inspectImage", args: ["app:local"] }]);
});

test("resolves a loaded immutable image ID without treating it as a registry reference", async () => {
	const reference = `sha256:${"a".repeat(64)}`;
	const f = fixture();
	expect(await f.service.resolveImage(reference)).toBe("sha256:a");
	expect(f.calls).toEqual([{ operation: "inspectImage", args: [reference] }]);
});

test("reports an absent immutable image ID without attempting a registry pull", async () => {
	const f = fixture({
		async inspectImage() {
			return null;
		},
	});
	await expect(f.service.resolveImage(`sha256:${"a".repeat(64)}`)).rejects.toMatchObject({ kind: "not-found" });
	expect(f.calls).toEqual([]);
});

test.each(["app:1", "app:local", "sha256:release"])(
	"pulls and inspects images that need resolving: %s",
	async (reference) => {
		let inspections = 0;
		const order: string[] = [];
		const f = fixture({
			async inspectImage() {
				order.push("inspect");
				return reference.endsWith(":local") && inspections++ === 0 ? null : { id: "sha256:new" };
			},
			async pullImage() {
				order.push("pull");
			},
		});
		expect(await f.service.resolveImage(reference)).toBe("sha256:new");
		expect(order).toEqual(reference.endsWith(":local") ? ["inspect", "pull", "inspect"] : ["pull", "inspect"]);
	},
);

test("image failures propagate and a successful pull must produce an inspectable image", async () => {
	const f = fixture({
		async pullImage() {
			throw new DockerClientError("unavailable");
		},
	});
	await expect(f.service.resolveImage("app:1")).rejects.toMatchObject({ kind: "unavailable" });
	expect(f.calls).toEqual([]);
	await expect(
		fixture({
			async inspectImage() {
				return null;
			},
		}).service.resolveImage("app:1"),
	).rejects.toMatchObject({ kind: "not-found" });
});
test("log reads verify service ownership before accessing container output", async () => {
	const calls: string[] = [];
	const f = fixture({
		async readContainerLogs(id) {
			calls.push(id);
			return "logs";
		},
	});
	expect(await f.service.readServiceContainerLogs("demo", "c")).toBe("logs");
	await expect(f.service.readServiceContainerLogs("other", "c")).rejects.toMatchObject({ kind: "ownership" });
	expect(calls).toEqual(["c"]);
});
test.each(["old-secret", "rotated-secret"])(
	"log output redacts actual container secret values across rotation: %s",
	async (secret) => {
		const f = fixture({
			async inspectContainer() {
				return { ...details, env: { PASSWORD: secret } };
			},
			async readContainerLogs() {
				return `PASSWORD=${secret}\n`;
			},
		});
		expect(await f.service.readServiceContainerLogs("demo", "c")).toBe("PASSWORD=[redacted]\n");
	},
);
