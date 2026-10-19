import { expect, test } from "vitest";

import { DeploymentError } from "./contracts.ts";
import { DockerWorkloadClient, type EngineTransport } from "./docker-client.ts";

const resource = {
	type: "web" as const,
	image: "app:1",
	ingress: { public: true as const, port: 8080 },
	env: [{ name: "FOO", value: "bar" }],
	healthcheckUrl: "/health",
};
function fixture(
	respond: (method: string, path: string, body?: unknown) => { status?: number; data?: unknown; raw?: string },
) {
	const calls: { method: string; path: string; body?: unknown }[] = [];
	const engine: EngineTransport = {
		async request(method, path, body) {
			calls.push({ method, path, body });
			const result = respond(method, path, body);
			return { status: result.status ?? 200, body: result.raw ?? JSON.stringify(result.data ?? {}) };
		},
	};
	return {
		client: new DockerWorkloadClient(
			engine,
			"local",
			async () => true,
			async () => {},
		),
		calls,
	};
}
test("creates isolated labeled networks and attaches only the control plane and Envoy", async () => {
	const f = fixture((method, path) => {
		if (path.startsWith("/networks/") && method === "GET") return { status: 404 };
		if (path.startsWith("/containers/json"))
			return { data: [{ Id: path.includes("envoy") ? "envoy-id" : "paas-id" }] };
		return { status: 201, data: { Id: "network" } };
	});
	await f.client.prepareNetwork("demo");
	expect(f.calls.find((call) => call.path === "/networks/create")?.body).toEqual({
		Name: "paas-local-demo",
		Driver: "bridge",
		Labels: { "homelab-paas.cluster": "local", "homelab-paas.service": "demo" },
	});
	expect(f.calls.filter((call) => call.path.endsWith("/connect")).map((call) => call.body)).toEqual([
		{ Container: "paas-id" },
		{ Container: "envoy-id" },
	]);
});
test("uses resolved image IDs, resource aliases and ownership labels without publishing ports", async () => {
	const f = fixture(() => ({ status: 201, data: { Id: "container" } }));
	expect(await f.client.create("demo", "app", "commit", "spec", resource, "sha256:image")).toBe("container");
	expect(f.calls.at(-1)?.body).toEqual({
		Image: "sha256:image",
		Env: ["FOO=bar"],
		Labels: {
			"homelab-paas.cluster": "local",
			"homelab-paas.service": "demo",
			"homelab-paas.resource": "app",
			"homelab-paas.revision": "commit",
			"homelab-paas.spec": "spec",
		},
		HostConfig: { NetworkMode: "paas-local-demo", RestartPolicy: { Name: "unless-stopped" } },
		NetworkingConfig: { EndpointsConfig: { "paas-local-demo": { Aliases: ["app"] } } },
	});
});
test("lists only owned containers and normalizes lifecycle state", async () => {
	const f = fixture(() => ({
		data: [
			{
				Id: "id",
				State: "exited",
				Labels: {
					"homelab-paas.resource": "app",
					"homelab-paas.revision": "commit",
					"homelab-paas.spec": "spec",
				},
			},
		],
	}));
	expect(await f.client.list("demo")).toEqual([
		{ id: "id", running: false, resourceId: "app", revision: "commit", spec: "spec" },
	]);
	expect(decodeURIComponent(f.calls.at(-1)?.path ?? "")).toContain("homelab-paas.service=demo");
});
test("uses a preloaded local image and pulls a missing image, detecting streamed pull errors", async () => {
	const local = fixture(() => ({ data: { Id: "sha256:local" } }));
	expect(await local.client.resolveImage("test-service:local")).toBe("sha256:local");
	expect(local.calls).toHaveLength(1);
	let inspections = 0;
	const remote = fixture((_method, path) =>
		path.startsWith("/images/create")
			? { raw: '{"status":"done"}\n' }
			: ++inspections === 1
				? { status: 404 }
				: { data: { Id: "sha256:pulled" } },
	);
	expect(await remote.client.resolveImage("app:1")).toBe("sha256:pulled");
	const failed = fixture((_method, path) =>
		path.startsWith("/images/create") ? { raw: '{"error":"registry secret"}\n' } : { status: 404 },
	);
	await expect(failed.client.resolveImage("app:1")).rejects.toThrow("Cannot pull workload image");
});
test("readiness uses the service-network IP and application health path; failures are bounded and sanitized", async () => {
	const f = fixture(() => ({
		data: {
			State: { Running: true },
			NetworkSettings: { Networks: { "paas-local-demo": { IPAddress: "10.0.0.2" } } },
			Config: { Labels: { "homelab-paas.service": "demo" } },
		},
	}));
	expect(await f.client.waitReady("id", resource)).toEqual({
		address: "10.0.0.2",
		port: 8080,
		healthcheckPath: "/health",
	});
	let probes = 0;
	const unready = new DockerWorkloadClient(
		{
			async request() {
				return {
					status: 200,
					body: JSON.stringify({
						State: { Running: true },
						NetworkSettings: { Networks: { "paas-local-demo": { IPAddress: "10.0.0.2" } } },
						Config: { Labels: { "homelab-paas.service": "demo" } },
					}),
				};
			},
		},
		"local",
		async () => {
			probes++;
			return false;
		},
		async () => {},
	);
	await expect(unready.waitReady("id", resource)).rejects.toThrow("Workload readiness failed");
	expect(probes).toBe(30);
	const broken = fixture(() => ({ status: 500, raw: "credentials" }));
	await expect(broken.client.list("demo")).rejects.toBeInstanceOf(DeploymentError);
});
