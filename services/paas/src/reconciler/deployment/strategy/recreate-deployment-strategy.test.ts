import { expect, test } from "vitest";

import type { IDockerService } from "../../../docker/docker-service.ts";
import type { DockerContainerDetails, ServiceContainer } from "../../../docker/types.ts";
import { RecreateDeploymentStrategy } from "./recreate-deployment-strategy.ts";
import type { DeploymentRequest } from "./types.ts";

const request: DeploymentRequest = {
	serviceId: "demo",
	resourceId: "app",
	revision: "rev",
	spec: "spec",
	resource: {
		type: "web",
		image: "app:1",
		ingress: { public: true, port: 8080 },
		env: [{ name: "FOO", value: "bar" }],
		command: ["node", "app.js"],
		healthcheckUrl: "/ready",
		termination: { timeoutSeconds: 45 },
	},
};

function fixture() {
	const calls: { action: string; args: unknown[] }[] = [];
	const record = (action: string, ...args: unknown[]) => {
		calls.push({ action, args });
	};
	const old: ServiceContainer = {
		id: "old",
		imageId: "image",
		resourceId: "app",
		revision: "old",
		spec: "old",
		state: "running",
	};
	const docker: IDockerService = {
		async listServiceContainers(...args) {
			record("list", ...args);
			return [old];
		},
		async inspectServiceNetwork(...args) {
			record("network", ...args);
			return { id: "n", name: "network", driver: "bridge", labels: {}, containerIds: ["new"] };
		},
		async inspectServiceContainer(...args) {
			record("inspect", ...args);
			return {
				id: "new",
				imageId: "image",
				running: true,
				labels: {},
				networks: { network: { address: "10.0.0.2", aliases: [] }, other: { address: "wrong", aliases: [] } },
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
	const routes = {
		async set(...args: [string, { address: string; port: number; healthcheckPath: string } | undefined]) {
			record("route", ...args);
		},
	};
	const probe = async (...args: [string, number, string]) => {
		record("probe", ...args);
		return true;
	};
	const pause = async (ms: number) => {
		record("pause", ms);
	};
	return {
		docker,
		calls,
		routes,
		strategy: new RecreateDeploymentStrategy(docker, routes, probe, pause),
		probe,
		pause,
	};
}

test("recreate resolves first, withdraws routing, replaces scoped containers and publishes only after readiness", async () => {
	const f = fixture();
	await f.strategy.deploy(request);
	expect(f.calls.map((c) => c.action)).toEqual([
		"list",
		"resolve",
		"prepare",
		"network",
		"route",
		"stop",
		"remove",
		"create",
		"start",
		"inspect",
		"probe",
		"route",
	]);
	expect(f.calls.at(0)?.args).toEqual(["demo", "app"]);
	expect(f.calls.find((c) => c.action === "stop")?.args).toEqual(["demo", "old", 45]);
	expect(f.calls.find((c) => c.action === "create")?.args).toEqual([
		{
			serviceId: "demo",
			resourceId: "app",
			revision: "rev",
			spec: "spec",
			imageId: "sha256:new",
			command: ["node", "app.js"],
			env: { FOO: "bar" },
		},
	]);
	expect(f.calls.find((c) => c.action === "probe")?.args).toEqual(["10.0.0.2", 8080, "/ready"]);
	expect(f.calls.filter((c) => c.action === "route").map((c) => c.args)).toEqual([
		["demo", undefined],
		["demo", { address: "10.0.0.2", port: 8080, healthcheckPath: "/ready" }],
	]);
});

test("uses descriptor defaults for termination and health checks", async () => {
	const f = fixture();
	await f.strategy.deploy({
		...request,
		resource: { type: "web", image: "app:1", ingress: { public: true, port: 8080 } },
	});
	expect(f.calls.find((c) => c.action === "stop")?.args).toEqual(["demo", "old", 30]);
	expect(f.calls.at(-1)?.args).toEqual([
		"demo",
		{ address: "10.0.0.2", port: 8080, healthcheckPath: "/healthcheck" },
	]);
});

test("initial deployment handles an empty current state", async () => {
	const f = fixture();
	f.docker.listServiceContainers = async () => [];
	await f.strategy.deploy(request);
	expect(f.calls.some((c) => ["stop", "remove"].includes(c.action))).toBe(false);
	expect(f.calls.at(-1)?.action).toBe("route");
});

test.each(["resolveImage", "prepareServiceNetwork", "inspectServiceNetwork"] as const)(
	"preflight failure preserves existing containers and routing: %s",
	async (method) => {
		const f = fixture();
		f.docker[method] = async () => {
			throw new Error("preflight failed");
		};
		await expect(f.strategy.deploy(request)).rejects.toThrow("preflight failed");
		expect(f.calls.some((c) => ["route", "stop", "remove", "create"].includes(c.action))).toBe(false);
	},
);

test("a missing prepared network fails before withdrawing the active route", async () => {
	const f = fixture();
	f.docker.inspectServiceNetwork = async () => null;
	await expect(f.strategy.deploy(request)).rejects.toThrow("Service network is unavailable");
	expect(f.calls.some((c) => c.action === "route")).toBe(false);
});

test("withdrawal failure prevents stopping containers", async () => {
	const f = fixture();
	f.routes.set = async () => {
		throw new Error("route failed");
	};
	await expect(f.strategy.deploy(request)).rejects.toThrow("route failed");
	expect(f.calls.some((c) => c.action === "stop")).toBe(false);
});

test.each([
	"stopServiceContainer",
	"removeServiceContainer",
	"createResourceContainer",
	"startServiceContainer",
] as const)("deployment failures leave the route withdrawn: %s", async (method) => {
	const f = fixture();
	f.docker[method] = async () => {
		throw new Error("deployment failed");
	};
	await expect(f.strategy.deploy(request)).rejects.toThrow("deployment failed");
	expect(f.calls.filter((c) => c.action === "route").map((c) => c.args)).toEqual([["demo", undefined]]);
});

test("readiness retries transient absence and never probes stopped containers or the wrong network", async () => {
	const f = fixture();
	let attempt = 0;
	f.docker.inspectServiceContainer = async (): Promise<DockerContainerDetails | null> => {
		attempt++;
		return attempt === 1
			? null
			: {
					id: "new",
					imageId: "image",
					labels: {},
					running: attempt > 2,
					networks:
						attempt === 3
							? { other: { address: "wrong", aliases: [] } }
							: { network: { address: "10.0.0.2", aliases: [] } },
				};
	};
	await f.strategy.deploy(request);
	expect(attempt).toBe(4);
	expect(f.calls.filter((c) => c.action === "pause")).toHaveLength(3);
	expect(f.calls.filter((c) => c.action === "probe")).toHaveLength(1);
});

test("readiness exhaustion is bounded and never publishes an unready endpoint", async () => {
	const f = fixture();
	let probes = 0;
	const strategy = new RecreateDeploymentStrategy(
		f.docker,
		f.routes,
		async () => {
			probes++;
			return false;
		},
		f.pause,
	);
	await expect(strategy.deploy(request)).rejects.toThrow("Container readiness failed");
	expect(probes).toBe(30);
	expect(f.calls.filter((c) => c.action === "pause")).toHaveLength(29);
	expect(f.calls.filter((c) => c.action === "route").map((c) => c.args)).toEqual([["demo", undefined]]);
	expect(f.calls.slice(-2)).toEqual([
		{ action: "stop", args: ["demo", "new", 45] },
		{ action: "remove", args: ["demo", "new"] },
	]);
});

test("route publication failures propagate for the caller to retry", async () => {
	const f = fixture();
	f.routes.set = async (_serviceId, endpoint) => {
		if (endpoint) throw new Error("publication failed");
	};
	await expect(f.strategy.deploy(request)).rejects.toThrow("publication failed");
	expect(f.calls.slice(-2)).toEqual([
		{ action: "stop", args: ["demo", "new", 45] },
		{ action: "remove", args: ["demo", "new"] },
	]);
});
