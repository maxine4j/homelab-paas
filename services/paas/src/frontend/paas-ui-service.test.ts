import type { HealthStatus, UiServiceEvent } from "@homelab-paas/shared-contracts";
import { expect, test, vi } from "vitest";

import { parseConfig, decodeDescriptorYaml } from "../config/paas-config.ts";
import type { DockerContainerDetails } from "../docker/types.ts";
import { ResourceSpecification } from "../reconciler/resource-specification.ts";
import { ResourceStatusService } from "../status/resource-status-service.ts";
import { testConfig } from "../util/test/config.ts";
import { captureLogs } from "../util/test/logs.ts";
import { parseYaml } from "../util/yaml.ts";
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
const fixture = (health: HealthStatus = "Degraded") => {
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
	const inspectServiceContainer = vi.fn(async (): Promise<DockerContainerDetails | null> => ({
		id: "c",
		imageId: "sha256:a",
		running: true,
		labels: {},
		env: { TOKEN: "actual-secret-canary" },
		networks: { demo: { address: "172.1.0.2", aliases: ["app"] } },
	}));
	const followLogs = vi.fn(
		async (
			_serviceId: string,
			_containerId: string,
			_secrets: string[],
			receive: (content: string) => void,
			_signal: AbortSignal,
		) => {
			receive("safe tail");
		},
	);
	const followControlPlane = vi.fn(async (receive: (id: string, content: string) => void, _signal: AbortSignal) => {
		receive("control", "safe control tail");
	});
	const listEvents = vi.fn(async (): Promise<UiServiceEvent[]> => [
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
		new ResourceStatusService(new ResourceSpecification(), {
			resolve: async (_serviceId, env) =>
				env.map((entry) => ({ name: entry.name, value: "value" in entry ? entry.value : "test-secret" })),
		}),
		testConfig(config),
		{ fetchFile, readCommit },
		decodeDescriptorYaml,
		{
			listServiceContainers,
			inspectServiceContainer,
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
		{ getStatus: (_serviceId, _resourceId, containers) => (containers.length ? health : "Missing") },
		{ follow: followLogs, followControlPlane },
	);
	return {
		service,
		config,
		fetchFile,
		readCommit,
		listServiceContainers,
		inspectServiceContainer,
		readServiceContainerLogs,
		listEvents,
		followLogs,
		followControlPlane,
	};
};

test("control-plane logs delegate safe tails without requiring a workload descriptor and sanitize failures", async () => {
	const f = fixture();
	const receive = vi.fn();
	const signal = new AbortController().signal;
	await f.service.followControlPlaneLogs(receive, signal);
	expect(receive).toHaveBeenCalledWith({ containerId: "control", content: "safe control tail", tail: 200 });
	expect(f.followControlPlane).toHaveBeenCalledWith(expect.any(Function), signal);
	expect(f.fetchFile).not.toHaveBeenCalled();
	f.followControlPlane.mockRejectedValueOnce(new Error("private Docker error"));
	await expect(f.service.followControlPlaneLogs(receive, signal)).rejects.toMatchObject({
		kind: "unavailable",
		message: "Cluster data is unavailable; retry shortly",
	});
});

test.each(["Progressing", "Missing", "Healthy", "Degraded", "Unknown"] as const)(
	"service and resource snapshots expose %s resource health independently of container state",
	async (health) => {
		const f = fixture(health);
		expect(
			(await f.service.getService("demo")).resources.find(({ resourceId }) => resourceId === "app"),
		).toMatchObject({ health, containers: [{ state: "running" }] });
		expect(await f.service.getResource("demo", "app")).toMatchObject({
			health,
			containers: [{ state: "running", running: true }],
		});
	},
);

test("resource inspection cannot retain healthy status after its container disappears or stops", async () => {
	const f = fixture("Healthy");
	f.inspectServiceContainer.mockResolvedValueOnce(null);
	expect(await f.service.getResource("demo", "app")).toMatchObject({
		health: "Missing",
		containers: [{ state: "missing" }],
	});
	f.inspectServiceContainer.mockResolvedValueOnce({
		id: "c",
		imageId: "image",
		running: false,
		labels: {},
		networks: {},
	});
	expect(await f.service.getResource("demo", "app")).toMatchObject({
		health: "Degraded",
		containers: [{ running: false }],
	});
});

test("live logs verify configured service/resource/container and require descriptor redaction before opening a follow", async () => {
	const f = fixture();
	const receive = vi.fn();
	const signal = new AbortController().signal;
	await f.service.followLogs("demo", "app", "c", receive, signal);
	expect(f.followLogs).toHaveBeenCalledWith("demo", "c", ["env-canary"], expect.any(Function), signal);
	expect(receive).toHaveBeenCalledWith({ containerId: "c", content: "safe tail", tail: 200 });
	f.followLogs.mockClear();
	for (const [service, resource, container] of [
		["missing", "app", "c"],
		["demo", "db", "c"],
		["demo", "app", "orphan"],
	])
		await expect(f.service.followLogs(service!, resource!, container!, receive, signal)).rejects.toMatchObject({
			kind: "not-found",
		});
	expect(f.followLogs).not.toHaveBeenCalled();
	f.fetchFile.mockRejectedValue(new Error("private Git error"));
	await expect(f.service.followLogs("demo", "app", "c", receive, signal)).rejects.toMatchObject({
		kind: "unavailable",
	});
	expect(f.followLogs).not.toHaveBeenCalled();
});

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

test("service detail supplies YAML of the sanitized descriptor", async () => {
	const f = fixture();
	const detail = await f.service.getService("demo");
	expect(detail.descriptorYaml).toContain("serviceId: demo");
	expect(detail.descriptorYaml).toContain("image: app:1");
	expect(detail.descriptorYaml).not.toContain("--password=env-canary");
});

test("resource supplies YAML matching its sanitized configuration and omits it for observed-only resources", async () => {
	const f = fixture();
	const resource = await f.service.getResource("demo", "app");
	expect(resource).toHaveProperty("configYaml", expect.stringContaining("image: app:1"));
	const yaml = resource.configYaml!;
	expect(yaml).toContain("value: env-canary");
	expect(yaml).not.toContain("--password=env-canary");
	expect(await f.service.getResource("demo", "old")).not.toHaveProperty("configYaml", expect.anything());
});

test("service list includes redacted metadata for active and desired commits with live status", async () => {
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
	expect(f.listServiceContainers).toHaveBeenCalled();
});

test("service list preserves deployment status when Git is unavailable", async () => {
	const f = fixture();
	f.fetchFile.mockRejectedValue(new Error("Git unavailable"));
	f.readCommit.mockRejectedValue(new Error("private-metadata-error"));
	const summaries = await f.service.listServices();
	expect(summaries).toMatchObject([
		{ serviceId: "demo", sync: "Unknown", activeRevision: "old", desiredRevision: "new" },
	]);
	expect(summaries[0]).not.toHaveProperty("activeRevisionMetadata", expect.anything());
	expect(JSON.stringify(summaries)).not.toContain("private-metadata-error");
	expect(f.readCommit).toHaveBeenCalledTimes(2);
	expect(summaries[0]?.description).toBeUndefined();
	expect(summaries[0]?.primaryUrl).toBeUndefined();
});

test.each([
	[{ app: descriptor.resources.app }, "http://demo.example.com"],
	[
		{ app: descriptor.resources.app, other: { ...descriptor.resources.app, primary: true } },
		"http://demo.example.com",
	],
	[{ db: descriptor.resources.db }, undefined],
])("service list supplies a redacted description and only a primary web link", async (resources, primaryUrl) => {
	const f = fixture();
	f.fetchFile.mockResolvedValue({
		revision: "new",
		content: JSON.stringify({
			...descriptor,
			metadata: { serviceId: "demo", description: "Archive env-canary" },
			resources,
		}),
	});
	expect((await f.service.listServices()).at(0)).toMatchObject({
		description: "app" in resources ? "Archive [redacted]" : "Archive env-canary",
		primaryUrl,
	});
	expect(f.listServiceContainers).toHaveBeenCalled();
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

test("legacy diagnostic context is projected as bounded YAML without mutating stored history", async () => {
	const f = fixture();
	const original = JSON.stringify({
		error: { message: "bind failed", stack: "Error: bind failed\n    at start", status: 500 },
		context: { resource: { image: "app:1" } },
	});
	const event: UiServiceEvent = {
		timestamp: 1,
		level: "error",
		event: "reconciliation.failed",
		message: "legacy",
		diagnostics: original,
	};
	f.listEvents.mockResolvedValue([event]);
	const [projected] = await f.service.getEvents("demo");
	const diagnostic = JSON.parse(projected!.diagnostics!);
	expect(parseYaml(diagnostic.contextYaml, "context.yaml")).toEqual({ resource: { image: "app:1" } });
	expect(diagnostic.error).toEqual(JSON.parse(original).error);
	expect(event.diagnostics).toBe(original);
	for (const diagnostics of ["Error: plain", '{"error":\n[truncated]']) {
		f.listEvents.mockResolvedValue([{ ...event, diagnostics }]);
		expect((await f.service.getEvents("demo"))[0]!.diagnostics).toBe(diagnostics);
	}
	const large = JSON.stringify({ error: { message: "failed" }, context: { value: "雪\n".repeat(2500) } });
	f.listEvents.mockResolvedValue([{ ...event, diagnostics: large }]);
	const text = (await f.service.getEvents("demo"))[0]!.diagnostics!;
	expect(Buffer.byteLength(JSON.stringify(text))).toBeLessThanOrEqual(32768);
	expect(JSON.parse(text).error.message).toBe("failed");
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
			sync: "Unknown",
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
		new ResourceStatusService(new ResourceSpecification(), {
			resolve: async (_serviceId, env) =>
				env.map((entry) => ({ name: entry.name, value: "value" in entry ? entry.value : "test-secret" })),
		}),
		configuration,
		{ fetchFile: vi.fn(), readCommit: vi.fn() },
		decodeDescriptorYaml,
		{ listServiceContainers: vi.fn(), inspectServiceContainer: vi.fn(), readServiceContainerLogs: vi.fn() },
		{ read: vi.fn(), write: vi.fn() },
		{ append: async () => {}, list: async () => [] },
		{ getStatus: vi.fn() },
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
	expect(parseYaml(resource.configYaml!, "resource.yaml")).toEqual(resource.config);
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

test("list and detail aggregate live health independently of failed deployment checkpoints", async () => {
	const f = fixture("Healthy");
	f.fetchFile.mockResolvedValue({
		revision: "new",
		content: JSON.stringify({ ...descriptor, resources: { app: descriptor.resources.app } }),
	});
	f.listServiceContainers.mockResolvedValue([
		{ id: "c", resourceId: "app", imageId: "sha256:a", revision: "old", spec: "s", state: "running" },
	]);
	expect(await f.service.listServices()).toMatchObject([{ sync: "OutOfSync", health: "Healthy" }]);
	expect(await f.service.getService("demo")).toMatchObject({
		sync: "OutOfSync",
		health: "Healthy",
		resources: [{ sync: "OutOfSync", health: "Healthy" }],
	});
});

test("service list preserves revisions when Docker observation fails without claiming Missing", async () => {
	const f = fixture();
	f.listServiceContainers.mockRejectedValue(new Error("Docker unavailable"));
	expect(await f.service.listServices()).toMatchObject([
		{ activeRevision: "old", sync: "Unknown", health: "Unknown" },
	]);
});

test("failing readiness does not make an applied specification OutOfSync", async () => {
	const f = fixture("Degraded");
	const content = JSON.stringify({ ...descriptor, resources: { app: descriptor.resources.app } });
	f.fetchFile.mockResolvedValue({ revision: "new", content });
	const resource = decodeDescriptorYaml(content, "demo", "new").resources["app"];
	if (resource?.type !== "web") throw new Error("Expected web fixture");
	const spec = new ResourceSpecification().get("app", {
		...resource,
		primary: true,
		env: descriptor.resources.app.env,
	});
	f.listServiceContainers.mockResolvedValue([
		{ id: "c", resourceId: "app", imageId: "sha256:a", revision: "old", spec, state: "running" },
	]);
	expect(await f.service.listServices()).toMatchObject([{ sync: "Synced", health: "Degraded" }]);
	expect(await f.service.getService("demo")).toMatchObject({ sync: "Synced", health: "Degraded" });
});

test("a disappearing container does not claim a known sync comparison when the descriptor is unavailable", async () => {
	const f = fixture("Healthy");
	f.fetchFile.mockRejectedValue(new Error("Git unavailable"));
	f.inspectServiceContainer.mockResolvedValueOnce(null);
	expect(await f.service.getResource("demo", "app")).toMatchObject({ sync: "Unknown", health: "Missing" });
});
