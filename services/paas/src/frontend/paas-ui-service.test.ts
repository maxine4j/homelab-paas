import { expect, test, vi } from "vitest";

import { parseConfig, decodeDescriptorYaml } from "../config/paas-config.ts";
import { PaasUiService } from "./paas-ui-service.ts";

const descriptor = {
	version: 1,
	metadata: { serviceId: "demo" },
	resources: {
		app: {
			type: "web",
			image: "app:1",
			ingress: { port: 80, public: true },
			env: [{ name: "PASSWORD", value: "env-canary" }],
			command: ["app", "--password=env-canary"],
		},
		db: { type: "postgres", image: "postgres:17" },
	},
};
const fixture = () => {
	const config = parseConfig({
		version: 1,
		metadata: { clusterId: "local" },
		ingress: { baseDomain: "example.com" },
		git: { pollIntervalSeconds: 5, operationTimeoutSeconds: 60 },
		reconciliation: { retryBackoffSeconds: 5, maxRetryBackoffSeconds: 60 },
		services: { demo: { remote: "local", descriptorPath: "/repo/demo.yaml" } },
	});
	const fetchFile = vi.fn(async () => ({ revision: "new", content: JSON.stringify(descriptor) }));
	const listServiceContainers = vi.fn(async () => [
		{ id: "c", resourceId: "app", imageId: "sha256:a", revision: "old", spec: "s", state: "running" },
		{ id: "orphan", resourceId: "old", imageId: "sha256:b", revision: "old", spec: "s", state: "exited" },
	]);
	const readServiceContainerLogs = vi.fn(async () => "hello env-canary\n");
	const service = new PaasUiService(
		config,
		{ fetchFile },
		decodeDescriptorYaml,
		{
			listServiceContainers,
			async inspectServiceContainer() {
				return {
					id: "c",
					imageId: "sha256:a",
					running: true,
					labels: {},
					env: { TOKEN: "actual-secret-canary" },
					networks: { demo: { address: "172.1.0.2", aliases: ["app"] } },
				};
			},
			readServiceContainerLogs,
		},
		{
			async read() {
				return {
					phase: "failed",
					desiredRevision: "new",
					activeRevision: "old",
					failures: 1,
					retryAt: 1000,
					error: "unsafe-canary",
				};
			},
			async write() {},
		},
	);
	return { service, config, fetchFile, listServiceContainers, readServiceContainerLogs };
};

test("cluster config is allowlisted and configured services remain visible without fetching Git", async () => {
	const f = fixture();
	f.config.auth = {
		github: { clientId: "id", clientSecret: "secret-canary", allowedUsers: ["owner"] },
		session: { issuer: "i", audience: "a", signingKey: "key-canary", ttlSeconds: 100 },
	};
	const cluster = await f.service.getCluster();
	expect(cluster.clusterId).toBe("local");
	expect(JSON.stringify(cluster)).not.toMatch(/secret-canary|key-canary/);
	expect(await f.service.listServices()).toEqual([
		{
			serviceId: "demo",
			phase: "failed",
			desiredRevision: "new",
			activeRevision: "old",
			failures: 1,
			retryAt: 1000,
		},
	]);
	expect(f.fetchFile).not.toHaveBeenCalled();
});

test("joins every desired resource with live containers, retaining resources absent from the descriptor", async () => {
	const { service } = fixture();
	const detail = await service.getService("demo");
	expect(detail.descriptorRevision).toBe("new");
	expect(detail.resources.map((r) => r.resourceId)).toEqual(["app", "db", "old"]);
	expect(detail.resources.at(1)?.containers).toEqual([]);
	expect(JSON.stringify(detail)).not.toMatch(/env-canary|unsafe-canary/);
	expect((await service.getResource("demo", "app")).containers.at(0)).toMatchObject({
		running: true,
		networks: { demo: { address: "172.1.0.2" } },
	});
	expect(await service.getLogs("demo", "app", "c")).toEqual({
		containerId: "c",
		content: "hello [redacted]\n",
		tail: 200,
	});
});

test("unknown service, resource and container never read unrelated logs", async () => {
	const f = fixture();
	await expect(f.service.getService("constructor")).rejects.toMatchObject({ kind: "not-found" });
	await expect(f.service.getResource("demo", "missing")).rejects.toMatchObject({ kind: "not-found" });
	await expect(f.service.getLogs("demo", "db", "c")).rejects.toMatchObject({ kind: "not-found" });
	expect(f.readServiceContainerLogs).not.toHaveBeenCalled();
});

test("secret-reference snapshots never expose resolved Docker environment values", async () => {
	const f = fixture();
	f.fetchFile.mockResolvedValue({
		revision: "new",
		content: JSON.stringify({
			...descriptor,
			resources: {
				app: {
					...descriptor.resources.app,
					env: [{ name: "TOKEN", secret: true }],
					volumes: [{ hostPath: "/srv/data", mountPath: "/data" }],
					limits: { cpus: 0.5, memoryMiB: 64 },
				},
			},
		}),
	});
	const resource = await f.service.getResource("demo", "app");
	expect(JSON.stringify(resource)).not.toContain("actual-secret-canary");
	expect(resource.config).toMatchObject({
		env: [{ name: "TOKEN", secret: "[redacted]" }],
		volumes: [{ hostPath: "/srv/data", mountPath: "/data" }],
		limits: { cpus: 0.5, memoryMiB: 64 },
	});
});

test("Git failures preserve live resource visibility and disable logs when redaction inputs cannot be loaded", async () => {
	const f = fixture();
	f.fetchFile.mockRejectedValue(new Error("secret-canary"));
	const detail = await f.service.getService("demo");
	expect(detail.descriptorStatus).toBe("unavailable");
	expect(detail.resources.map((r) => r.resourceId)).toEqual(["app", "old"]);
	await expect(f.service.getLogs("demo", "app", "c")).rejects.toMatchObject({ kind: "unavailable" });
});
