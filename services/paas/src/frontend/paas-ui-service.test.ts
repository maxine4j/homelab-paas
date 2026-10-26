import { expect, test, vi } from "vitest";

import { parseConfig, decodeDescriptorYaml } from "../config/paas-config.ts";
import { testConfig } from "../util/test/config.ts";
import { captureLogs } from "../util/test/logs.ts";
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
	const readCommit = vi.fn(async (_serviceId: string, _source: unknown, revision: string) => ({
		authorName: "Alex",
		authoredAt: "2026-10-26T00:00:00Z",
		message: `Deploy ${revision} env-canary`,
	}));
	const listServiceContainers = vi.fn(async () => [
		{ id: "c", resourceId: "app", imageId: "sha256:a", revision: "old", spec: "s", state: "running" },
		{ id: "orphan", resourceId: "old", imageId: "sha256:b", revision: "old", spec: "s", state: "exited" },
	]);
	const readServiceContainerLogs = vi.fn(async () => "hello env-canary\n");
	const listEvents = vi.fn(async () => [
		{
			timestamp: 100,
			level: "error" as const,
			event: "reconciliation.failed" as const,
			message: "Cannot resolve application secrets; check the service env file and required variable names",
			resourceId: "app",
			failures: 1,
			retryAt: 1000,
		},
	]);
	const service = new PaasUiService(
		testConfig(config),
		{ fetchFile, readCommit },
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
		{ list: listEvents, append: async () => {} },
	);
	return { service, config, fetchFile, readCommit, listServiceContainers, readServiceContainerLogs, listEvents };
};

test("service detail reads metadata for each exact revision and redacts known secrets", async () => {
	const f = fixture();
	expect(await f.service.getService("demo")).toMatchObject({
		activeRevision: "old",
		descriptorRevision: "new",
		activeRevisionMetadata: {
			authorName: "Alex",
			authoredAt: "2026-10-26T00:00:00Z",
			message: "Deploy old [redacted]",
		},
		descriptorRevisionMetadata: { message: "Deploy new [redacted]" },
	});
	expect(f.readCommit.mock.calls.map((call) => call[2])).toEqual(["old", "new"]);
	f.readCommit.mockClear();
	await f.service.getResource("demo", "app");
	expect(f.readCommit).not.toHaveBeenCalled();
});

test("service list includes redacted metadata for active and desired commits without Docker", async () => {
	const f = fixture();
	expect(await f.service.listServices()).toMatchObject([
		{
			serviceId: "demo",
			activeRevisionMetadata: {
				authorName: "Alex",
				authoredAt: "2026-10-26T00:00:00Z",
				message: "Deploy old [redacted]",
			},
			desiredRevisionMetadata: { message: "Deploy new [redacted]" },
		},
	]);
	expect(f.readCommit.mock.calls.map((call) => call[2])).toEqual(["old", "new"]);
	expect(f.listServiceContainers).not.toHaveBeenCalled();
});

test("service list preserves deployment status when Git is unavailable", async () => {
	const f = fixture();
	f.fetchFile.mockRejectedValue(new Error("Git unavailable"));
	f.readCommit.mockRejectedValue(new Error("private-metadata-error"));
	const summaries = await f.service.listServices();
	expect(summaries).toMatchObject([
		{ serviceId: "demo", phase: "failed", activeRevision: "old", desiredRevision: "new" },
	]);
	expect(summaries[0]).not.toHaveProperty("activeRevisionMetadata", expect.anything());
	expect(JSON.stringify(summaries)).not.toContain("private-metadata-error");
	expect(f.readCommit).toHaveBeenCalledTimes(2);
});

test("unavailable metadata preserves hashes, descriptor and observed resources", async () => {
	const f = fixture();
	f.readCommit.mockRejectedValue(new Error("private-metadata-error"));
	const detail = await f.service.getService("demo");
	expect(detail).toMatchObject({ activeRevision: "old", descriptorRevision: "new", descriptorStatus: "available" });
	expect(detail.activeRevisionMetadata).toBeUndefined();
	expect(detail.descriptorRevisionMetadata).toBeUndefined();
	expect(detail.resources).toHaveLength(3);
	expect(JSON.stringify(detail)).not.toContain("private-metadata-error");
	expect(f.readCommit).toHaveBeenCalledTimes(2);
});

test("matching active and descriptor revisions share one metadata read", async () => {
	const f = fixture();
	f.fetchFile.mockResolvedValue({ revision: "old", content: JSON.stringify(descriptor) });
	const detail = await f.service.getService("demo");
	expect(detail.activeRevisionMetadata).toEqual(detail.descriptorRevisionMetadata);
	expect(f.readCommit).toHaveBeenCalledTimes(1);
});

test("a missing active commit does not suppress descriptor commit details", async () => {
	const f = fixture();
	f.readCommit.mockRejectedValueOnce(new Error("Active commit unavailable"));
	const detail = await f.service.getService("demo");
	expect(detail.activeRevisionMetadata).toBeUndefined();
	expect(detail.descriptorRevisionMetadata).toMatchObject({ authorName: "Alex", message: "Deploy new [redacted]" });
});

test("active metadata remains available when the descriptor cannot be read", async () => {
	const f = fixture();
	f.fetchFile.mockRejectedValue(new Error("Git unavailable"));
	expect(await f.service.getService("demo")).toMatchObject({
		descriptorStatus: "unavailable",
		activeRevisionMetadata: { authorName: "Alex" },
	});
	expect(f.readCommit).toHaveBeenCalledTimes(1);
});

test("inspection resolves image tags from the fetched descriptor commit", async () => {
	const f = fixture();
	f.fetchFile.mockResolvedValue({
		revision: "abcdef0123456789abcdef0123456789abcdef01",
		content: JSON.stringify({
			...descriptor,
			resources: { app: { ...descriptor.resources.app, image: "app:${COMMIT_ID:7}" } },
		}),
	});
	expect(await f.service.getResource("demo", "app")).toMatchObject({ config: { image: "app:abcdef0" } });
});

test("events remain readable without Git or Docker and unknown services cannot access history", async () => {
	const f = fixture();
	f.fetchFile.mockRejectedValue(new Error("Git unavailable"));
	f.listServiceContainers.mockRejectedValue(new Error("Docker unavailable"));
	expect(await f.service.getEvents("demo")).toEqual(await f.listEvents());
	expect(f.fetchFile).not.toHaveBeenCalled();
	expect(f.listServiceContainers).not.toHaveBeenCalled();
	f.listEvents.mockClear();
	await expect(f.service.getEvents("missing")).rejects.toMatchObject({ kind: "not-found" });
	expect(f.listEvents).not.toHaveBeenCalled();
	f.listEvents.mockRejectedValue(new Error("private-storage-error"));
	await expect(f.service.getEvents("demo")).rejects.toMatchObject({
		kind: "unavailable",
		message: "Cluster data is unavailable; retry shortly",
	});
});

test("web inspection exposes resource URLs and only the primary service alias", async () => {
	const f = fixture();
	expect(await f.service.getResource("demo", "app")).toMatchObject({
		url: "http://app.demo.example.com",
		primaryUrl: "http://demo.example.com",
	});
	f.fetchFile.mockResolvedValue({
		revision: "multi",
		content: JSON.stringify({
			...descriptor,
			resources: {
				...descriptor.resources,
				app: { ...descriptor.resources.app, primary: false },
				admin: { ...descriptor.resources.app, primary: true },
			},
		}),
	});
	expect(await f.service.getResource("demo", "app")).toMatchObject({ url: "http://app.demo.example.com" });
	expect((await f.service.getResource("demo", "app")).primaryUrl).toBeUndefined();
	expect(await f.service.getResource("demo", "admin")).toMatchObject({
		url: "http://admin.demo.example.com",
		primaryUrl: "http://demo.example.com",
	});
	expect((await f.service.getResource("demo", "db")).url).toBeUndefined();
});

test("management operations preserve causes for internal diagnostics", async () => {
	const f = fixture();
	const cause = new Error("Docker failure");
	f.listServiceContainers.mockRejectedValue(cause);
	await expect(f.service.getService("demo")).rejects.toMatchObject({ cause });
	f.listServiceContainers.mockResolvedValue([
		{ id: "c", resourceId: "app", imageId: "sha256:a", revision: "old", spec: "s", state: "running" },
	]);
	f.readServiceContainerLogs.mockRejectedValue(cause);
	await expect(f.service.getLogs("demo", "app", "c")).rejects.toMatchObject({ cause });
});

test("descriptor fallback logs the original Git failure", async () => {
	const f = fixture();
	f.fetchFile.mockRejectedValue(new Error("Git failure"));
	const capture = captureLogs();
	try {
		await f.service.getService("demo");
	} finally {
		capture.restore();
	}
	expect(JSON.parse(capture.lines.at(0)!).err.message).toBe("Git failure");
});

test("cluster config is allowlisted and configured services include deployment summaries", async () => {
	const f = fixture();
	f.config.auth = {
		github: { clientId: "id", clientSecret: "secret-canary", allowedUsers: ["owner"] },
		session: { issuer: "i", audience: "a", signingKey: "key-canary", ttlSeconds: 100 },
	};
	const cluster = await f.service.getCluster();
	expect(cluster.clusterId).toBe("local");
	expect(JSON.stringify(cluster)).not.toMatch(/secret-canary|key-canary/);
	expect(await f.service.listServices()).toMatchObject([
		{
			serviceId: "demo",
			phase: "failed",
			desiredRevision: "new",
			activeRevision: "old",
			failures: 1,
			retryAt: 1000,
		},
	]);
});

test("cluster inspection and edits delegate configuration policy to the config service", async () => {
	const configuration = testConfig();
	const snapshot = { config: { safe: true }, revision: "r1", fields: [] };
	configuration.getEditableConfig = vi.fn(() => snapshot);
	configuration.updateConfig = vi.fn(async () => snapshot);
	const service = new PaasUiService(
		configuration,
		{ fetchFile: vi.fn(), readCommit: vi.fn() },
		decodeDescriptorYaml,
		{ listServiceContainers: vi.fn(), inspectServiceContainer: vi.fn(), readServiceContainerLogs: vi.fn() },
		{ read: vi.fn(), write: vi.fn() },
		{ append: async () => {}, list: async () => [] },
	);
	expect(await service.getCluster()).toEqual({ clusterId: "local", ...snapshot });
	const update = { revision: "r1", changes: [{ path: "git.pollIntervalSeconds", value: 9 }] };
	expect(await service.updateConfig(update)).toEqual(snapshot);
	expect(configuration.updateConfig).toHaveBeenCalledWith(update);
});

test("joins every desired resource with live containers, retaining resources absent from the descriptor", async () => {
	const { service } = fixture();
	const detail = await service.getService("demo");
	expect(detail.descriptorRevision).toBe("new");
	expect(detail).toHaveProperty(
		"descriptor",
		expect.objectContaining({ version: 1, metadata: { serviceId: "demo" } }),
	);
	expect(detail.resources.map((r) => r.resourceId)).toEqual(["app", "db", "old"]);
	expect(detail.resources.at(1)?.containers).toEqual([]);
	expect(detail.descriptor).toMatchObject({
		resources: { app: { env: [{ name: "PASSWORD", value: "env-canary" }], command: "[redacted]" } },
	});
	expect(JSON.stringify(detail)).not.toContain("unsafe-canary");
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

test("inspection preserves literal environment values while hiding secrets and commands", async () => {
	const f = fixture();
	const env = [
		{ name: "NODE_ENV", value: "production" },
		{ name: "LETTER", value: "a" },
		{ name: "EMPTY", value: "" },
		{ name: "PASSWORD_LABEL", value: "public-label" },
		{ name: "TOKEN", secret: true },
		{ name: "ENDPOINT", value: "https://user:password@example.com" },
	];
	f.fetchFile.mockResolvedValue({
		revision: "new",
		content: JSON.stringify({ ...descriptor, resources: { app: { ...descriptor.resources.app, env } } }),
	});
	const expected = {
		image: "app:1",
		command: "[redacted]",
		env: [
			...env.slice(0, 4),
			{ name: "TOKEN", secret: "[redacted]" },
			{ name: "ENDPOINT", value: "https://[redacted]@example.com" },
		],
	};
	const detail = await f.service.getService("demo");
	expect(detail.descriptor).toMatchObject({ resources: { app: expected } });
	expect(detail.resources.at(0)?.config).toMatchObject(expected);
	const resource = await f.service.getResource("demo", "app");
	expect(resource.config).toMatchObject(expected);
	expect(JSON.stringify(resource)).not.toContain("actual-secret-canary");
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
	expect(detail).not.toHaveProperty("descriptor", expect.anything());
	expect(detail.resources.map((r) => r.resourceId)).toEqual(["app", "old"]);
	await expect(f.service.getLogs("demo", "app", "c")).rejects.toMatchObject({ kind: "unavailable" });
});
