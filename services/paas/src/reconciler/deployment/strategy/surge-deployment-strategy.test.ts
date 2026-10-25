import { expect, test } from "vitest";

import type { IDockerService } from "../../../docker/docker-service.ts";
import type { DockerContainerDetails, ServiceContainer } from "../../../docker/types.ts";
import type { INetworkingService } from "../../networking/networking-service.ts";
import { SurgeDeploymentStrategy } from "./surge-deployment-strategy.ts";
import type { DeploymentRequest } from "./types.ts";

const request: DeploymentRequest = {
	serviceId: "demo",
	resourceId: "app",
	revision: "rev",
	spec: "spec",
	resource: {
		type: "web",
		image: "app:2",
		rolloutStrategy: "surge",
		ingress: { public: true, port: 8080 },
		command: ["node", "app.js"],
		env: [{ name: "TOKEN", value: "value" }],
		healthcheckUrl: "/ready",
		termination: { timeoutSeconds: 45 },
	},
};

test("publishes the selected resource with its primary policy", async () => {
	const f = fixture();
	await f.strategy.deploy({ ...request, resourceId: "admin", resource: { ...request.resource, primary: false } });
	expect(f.calls.find(({ action }) => action === "route")?.args).toEqual([
		"admin.demo",
		expect.objectContaining({ primary: false }),
	]);
});

test("propagates resolved secrets, arbitrary host mounts and CPU/memory limits to the surge replacement", async () => {
	const f = fixture();
	const volumes = [{ hostPath: "/srv/media", mountPath: "/media", readOnly: true }];
	const devices = [{ hostPath: "/dev/dri", mountPath: "/dev/dri" }];
	const supplementaryGroups = [109];
	const limits = { cpus: 0.5, memoryMiB: 256 };
	await f.strategy.deploy({
		...request,
		resource: {
			...request.resource,
			env: [{ name: "TOKEN", value: "resolved-secret" }],
			volumes,
			limits,
			devices,
			supplementaryGroups,
		},
	});
	expect(f.calls.find((c) => c.action === "create")?.args).toEqual([
		expect.objectContaining({ env: { TOKEN: "resolved-secret" }, volumes, limits, devices, supplementaryGroups }),
	]);
});

function fixture() {
	const calls: { action: string; args: unknown[] }[] = [];
	const record = (action: string, ...args: unknown[]) => {
		calls.push({ action, args });
	};
	const old: ServiceContainer = {
		id: "old",
		resourceId: "app",
		revision: "old",
		spec: "old",
		imageId: "image",
		state: "running",
	};
	const docker: IDockerService = {
		async readServiceContainerLogs() {
			return "";
		},
		async listServiceContainers(...args) {
			record("list", ...args);
			return [old];
		},
		async inspectServiceNetwork(...args) {
			record("network", ...args);
			return { id: "n", name: "network", driver: "bridge", labels: {}, containerIds: ["old"] };
		},
		async inspectServiceContainer(...args) {
			record("inspect", ...args);
			return {
				id: "new",
				imageId: "image",
				running: true,
				labels: {},
				networks: { network: { address: "10.0.0.2", aliases: [] } },
			};
		},
		async prepareServiceNetwork(...args) {
			record("prepare", ...args);
		},
		async resolveImage(...args) {
			record("resolve", ...args);
			return "sha256:new";
		},
		async createResourceContainer(...args) {
			record("create", ...args);
			return "new";
		},
		async startServiceContainer(...args) {
			record("start", ...args);
		},
		async stopServiceContainer(...args) {
			record("stop", ...args);
		},
		async removeServiceContainer(...args) {
			record("remove", ...args);
		},
	};
	const routes: INetworkingService = {
		async routeTo(...args) {
			record("route", ...args);
		},
		async withdraw(serviceId) {
			record("route", serviceId, undefined);
		},
	};
	const probe = async (...args: [string, number, string]) => {
		record("probe", ...args);
		return true;
	};
	const sleep = async (ms: number) => {
		record("sleep", ms);
	};
	const generateInstanceId = () => "attempt-1";
	return {
		docker,
		routes,
		calls,
		probe,
		sleep,
		generateInstanceId,
		strategy: new SurgeDeploymentStrategy(docker, routes, probe, sleep, generateInstanceId),
	};
}

test("starts alongside the old revision, switches only after readiness, then gracefully retires", async () => {
	const f = fixture();
	await f.strategy.deploy(request);
	expect(f.calls.map((c) => c.action)).toEqual([
		"list",
		"resolve",
		"prepare",
		"network",
		"create",
		"start",
		"inspect",
		"probe",
		"route",
		"stop",
		"remove",
	]);
	expect(f.calls.at(0)?.args).toEqual(["demo", "app"]);
	expect(f.calls.find((c) => c.action === "create")?.args).toEqual([
		{
			serviceId: "demo",
			resourceId: "app",
			revision: "rev",
			spec: "spec",
			instanceId: "attempt-1",
			imageId: "sha256:new",
			command: ["node", "app.js"],
			env: { TOKEN: "value" },
		},
	]);
	expect(f.calls.find((c) => c.action === "probe")?.args).toEqual(["10.0.0.2", 8080, "/ready"]);
	expect(f.calls.find((c) => c.action === "route")?.args).toEqual([
		"app.demo",
		{ address: "10.0.0.2", port: 8080, healthcheckPath: "/ready", public: true, primary: true },
	]);
	expect(f.calls.find((c) => c.action === "stop")?.args).toEqual(["demo", "old", 45]);
});

test("uses defaults and skips retirement on initial deployment", async () => {
	const f = fixture();
	f.docker.listServiceContainers = async () => [];
	await f.strategy.deploy({
		...request,
		resource: { type: "web", image: "app:2", ingress: { public: true, port: 8080 } },
	});
	expect(f.calls.find((c) => c.action === "probe")?.args).toEqual(["10.0.0.2", 8080, "/healthcheck"]);
	expect(f.calls.some((c) => ["sleep", "stop", "remove"].includes(c.action))).toBe(false);
});

test.each([false, undefined])("publishes private policy when public is %s", async (publicPolicy) => {
	const f = fixture();
	await f.strategy.deploy({
		...request,
		resource: { ...request.resource, ingress: { port: 8080, public: publicPolicy } },
	});
	expect(f.calls.find((call) => call.action === "route")?.args).toEqual([
		"app.demo",
		expect.objectContaining({ public: false }),
	]);
});

test("uses the default graceful shutdown timeout", async () => {
	const f = fixture();
	await f.strategy.deploy({ ...request, resource: { ...request.resource, termination: undefined } });
	expect(f.calls.find((c) => c.action === "stop")?.args).toEqual(["demo", "old", 30]);
});

test.each([
	"listServiceContainers",
	"resolveImage",
	"prepareServiceNetwork",
	"inspectServiceNetwork",
	"createResourceContainer",
] as const)("preparation failure preserves the old revision and routing: %s", async (method) => {
	const f = fixture();
	f.docker[method] = async () => {
		throw new Error("failed");
	};
	await expect(f.strategy.deploy(request)).rejects.toThrow("failed");
	expect(f.calls.some((c) => ["route", "stop", "remove"].includes(c.action))).toBe(false);
});

test("missing prepared network fails before creating the replacement", async () => {
	const f = fixture();
	f.docker.inspectServiceNetwork = async () => null;
	await expect(f.strategy.deploy(request)).rejects.toThrow("Service network is unavailable");
	expect(f.calls.some((c) => ["create", "route", "stop"].includes(c.action))).toBe(false);
});

test.each(["startServiceContainer", "inspectServiceContainer"] as const)(
	"startup failure cleans only the replacement: %s",
	async (method) => {
		const f = fixture();
		f.docker[method] = async () => {
			throw new Error("failed");
		};
		await expect(f.strategy.deploy(request)).rejects.toThrow("failed");
		expect(f.calls.filter((c) => ["stop", "remove"].includes(c.action))).toEqual([
			{ action: "stop", args: ["demo", "new", 45] },
			{ action: "remove", args: ["demo", "new"] },
		]);
		expect(f.calls.some((c) => c.action === "route")).toBe(false);
	},
);

test("readiness retries absence, stopped containers, missing addresses and failed probes", async () => {
	const f = fixture();
	let attempts = 0;
	f.docker.inspectServiceContainer = async (): Promise<DockerContainerDetails | null> => {
		attempts++;
		if (attempts === 1) return null;
		return {
			id: "new",
			imageId: "image",
			labels: {},
			running: attempts > 2,
			networks: attempts === 3 ? {} : { network: { address: "10.0.0.2", aliases: [] } },
		};
	};
	let probes = 0;
	const strategy = new SurgeDeploymentStrategy(
		f.docker,
		f.routes,
		async () => ++probes > 1,
		async (ms) => {
			expect(ms).toBe(1000);
			expect(f.calls.some((c) => ["route", "stop", "remove"].includes(c.action))).toBe(false);
			await f.sleep(ms);
		},
		f.generateInstanceId,
	);
	await strategy.deploy(request);
	expect(attempts).toBe(5);
	expect(f.calls.filter((c) => c.action === "sleep")).toHaveLength(4);
});

test("readiness exhaustion preserves the previous revision and removes only the candidate", async () => {
	const f = fixture();
	let probes = 0;
	const strategy = new SurgeDeploymentStrategy(
		f.docker,
		f.routes,
		async () => {
			probes++;
			return false;
		},
		f.sleep,
		f.generateInstanceId,
	);
	await expect(strategy.deploy(request)).rejects.toThrow("Container readiness failed");
	expect(probes).toBe(30);
	expect(f.calls.filter((c) => c.action === "sleep")).toHaveLength(29);
	expect(f.calls.filter((c) => c.action === "stop").map((c) => c.args)).toEqual([["demo", "new", 45]]);
	expect(f.calls.some((c) => c.action === "route")).toBe(false);
});

test("publication failure keeps both revisions because route acceptance is uncertain", async () => {
	const f = fixture();
	f.routes.routeTo = async () => {
		throw new Error("route failed");
	};
	await expect(f.strategy.deploy(request)).rejects.toThrow("route failed");
	expect(f.calls.some((c) => ["sleep", "stop", "remove"].includes(c.action))).toBe(false);
});

test("retirement tries every old container, reports failures, and retains the routed replacement", async () => {
	const f = fixture();
	f.docker.listServiceContainers = async () =>
		["old", "older"].map((id) => ({
			id,
			resourceId: "app",
			revision: "old",
			spec: "old",
			imageId: "image",
			state: "running",
		}));
	f.docker.stopServiceContainer = async (...args) => {
		f.calls.push({ action: "stop", args });
		if (args.at(1) === "old") throw new Error("stop failed");
	};
	await expect(f.strategy.deploy(request)).rejects.toThrow("Failed to retire previous containers");
	expect(f.calls.filter((c) => c.action === "stop").map((c) => c.args.at(1))).toEqual(["old", "older"]);
	expect(f.calls.filter((c) => c.action === "remove").map((c) => c.args.at(1))).toEqual(["older"]);
});

test("candidate cleanup failures are reported together with the startup failure", async () => {
	const f = fixture();
	f.docker.startServiceContainer = async () => {
		throw new Error("start failed");
	};
	f.docker.stopServiceContainer = async () => {
		throw new Error("cleanup failed");
	};
	await expect(f.strategy.deploy(request)).rejects.toThrow("Replacement startup and cleanup failed");
	expect(f.calls.some((c) => c.action === "route")).toBe(false);
});
