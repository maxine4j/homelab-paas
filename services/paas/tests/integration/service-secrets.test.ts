import { tmpdir } from "node:os";
import { join } from "node:path";

import Koa from "koa";
import { expect, test, vi } from "vitest";

import { decodeDescriptorYaml } from "../../src/config/paas-config.ts";
import { SecretStore } from "../../src/config/secret-store.ts";
import { ServiceSecrets } from "../../src/config/service-secrets.ts";
import { ChangeBus } from "../../src/events/change-bus.ts";
import { createPaasUiRouter } from "../../src/frontend/paas-ui-router.ts";
import { PaasUiService } from "../../src/frontend/paas-ui-service.ts";
import { JwtClient } from "../../src/ingress/auth/jwt-client.ts";
import { DesiredInputs } from "../../src/reconciler/desired-inputs.ts";
import { EnvironmentResolver } from "../../src/reconciler/environment-resolver.ts";
import { EventDiagnostics } from "../../src/reconciler/event-diagnostics.ts";
import { ResourceRoutingPolicy } from "../../src/reconciler/networking/resource-routing-policy.ts";
import { ReconcilerService } from "../../src/reconciler/reconciler-service.ts";
import { ReconciliationScheduler } from "../../src/reconciler/reconciliation-scheduler.ts";
import { ReconciliationStore } from "../../src/reconciler/reconciliation-store.ts";
import { ResourceSpecification } from "../../src/reconciler/resource-specification.ts";
import type { WebReconciliationRequest } from "../../src/reconciler/resources/web/web-reconciler.ts";
import { ResourceStatusService } from "../../src/status/resource-status-service.ts";
import { FileSystemKeyValueStore } from "../../src/store/file-system-store.ts";
import { atomicWriteFile, chmod, mkdir, mkdtemp, readFile, rm, stat, type FileWriter } from "../../src/util/file.ts";
import { sleep } from "../../src/util/sleep.ts";
import { testConfig } from "../../src/util/test/config.ts";
import { startTestApi } from "../../src/util/test/router.ts";

test("authenticated secret editing persists private files, retains values, resolves runtime env and rejects stale writes", async () => {
	const directory = await mkdtemp(join(tmpdir(), "paas-secrets-"));
	const envDirectory = join(directory, "env");
	const config = testConfig({ services: { demo: { remote: "local", descriptorPath: "/repo/demo.yaml" } } });
	const changes = new ChangeBus();
	const git = {
		fetchFile: vi.fn(async () => ({
			revision: "rev",
			content: JSON.stringify({
				version: 1,
				metadata: { serviceId: "demo" },
				resources: {
					app: {
						type: "web",
						image: "app:1",
						ingress: { port: 8080 },
						env: [
							{ name: "TOKEN", secret: true },
							{ name: "EMPTY", secret: true },
						],
					},
				},
			}),
		})),
		readCommit: vi.fn(),
	};
	const write: FileWriter = async (path, content, options) => {
		await mkdir(envDirectory, { recursive: true, mode: 0o700 });
		await chmod(envDirectory, 0o700);
		await atomicWriteFile(path, content, options);
	};
	const secrets = new ServiceSecrets(
		config,
		git,
		decodeDescriptorYaml,
		new SecretStore(envDirectory, readFile, write),
		changes,
	);
	const state = new ReconciliationStore(
		new FileSystemKeyValueStore<unknown>(
			directory,
			readFile,
			atomicWriteFile,
			(path) => rm(path, { force: true }),
			"yaml",
		),
	);
	const desiredInputs = new DesiredInputs(
		new ResourceRoutingPolicy(),
		config,
		git,
		decodeDescriptorYaml,
		new EnvironmentResolver(envDirectory, readFile),
	);
	const rollout = vi.fn(async (_request: WebReconciliationRequest) => {});
	const reconciler = new ReconcilerService(
		config,
		desiredInputs,
		{ type: "web", lifecycle: "deployment", reconcile: rollout },
		state,
		Date.now,
		{ type: "worker", lifecycle: "deployment", reconcile: async () => {} },
		{ append: async () => {}, list: async () => [] },
		new EventDiagnostics(config),
		changes,
	);
	const scheduler = new ReconciliationScheduler(
		config,
		reconciler,
		state,
		desiredInputs,
		sleep,
		Date.now,
		() => "secrets-api",
		changes,
	);
	await scheduler.start();
	const ui = new PaasUiService(
		new ResourceRoutingPolicy(),
		new ResourceStatusService(new ResourceSpecification(), {
			resolve: async (_serviceId, env) =>
				env.map((entry) => ({ name: entry.name, value: "value" in entry ? entry.value : "test-secret" })),
		}),
		config,
		git,
		decodeDescriptorYaml,
		{ listServiceContainers: vi.fn(), inspectServiceContainer: vi.fn(), readServiceContainerLogs: vi.fn() },
		{ read: async () => undefined, write: vi.fn() },
		{ append: vi.fn(), list: async () => [] },
		{ getStatus: vi.fn(), refineStatus: vi.fn() },
	);
	const tokens = new JwtClient(config, Date.now);
	const token = tokens.issue({ userId: "Alice" }, "session");
	const router = createPaasUiRouter(
		ui,
		{ refreshOne: vi.fn(), refreshAll: vi.fn() },
		{
			verifyAuthCookie: (value) => {
				const userId = tokens.verify(value ?? "", "session")?.userId;
				return userId ? { userId } : undefined;
			},
		},
		undefined,
		undefined,
		secrets,
	);
	const server = await startTestApi(new Koa().use(router.routes()).use(router.allowedMethods()));
	const url = `${server.origin}/api/ui/services/demo/secrets`;
	const headers = {
		origin: server.origin,
		"content-type": "application/json",
		"x-paas-secrets": "1",
		cookie: `__Secure-paas_session=${token}`,
	};
	try {
		expect((await fetch(url)).status).toBe(401);
		const initialResponse = await fetch(url, { headers });
		const initial = await initialResponse.json();
		const changes = [
			{ name: "TOKEN", value: " private#$\\token " },
			{ name: "EMPTY", value: "initial" },
			{ name: "FUTURE", value: "next-deployment" },
		];
		const saved = await fetch(url, {
			method: "PUT",
			headers,
			body: JSON.stringify({ revision: initial.revision, changes }),
		});
		expect(saved.status).toBe(200);
		await scheduler.settle();
		expect(rollout).toHaveBeenCalledTimes(1);
		expect(rollout.mock.calls.at(-1)?.[0].resource.env).toEqual([
			{ name: "TOKEN", value: " private#$\\token " },
			{ name: "EMPTY", value: "initial" },
		]);
		const metadata = await saved.json();
		expect(metadata.variables).toEqual([
			{ name: "EMPTY", configured: true, used: true },
			{ name: "TOKEN", configured: true, used: true },
			{ name: "FUTURE", configured: true, used: false },
		]);
		expect(JSON.stringify(metadata)).not.toContain("private");
		expect(JSON.stringify(metadata)).not.toContain("next-deployment");
		expect((await stat(envDirectory)).mode & 0o777).toBe(0o700);
		expect((await stat(join(envDirectory, "demo.env"))).mode & 0o777).toBe(0o600);
		expect(await readFile(join(envDirectory, "demo.env"))).toContain("FUTURE='next-deployment'");
		const resolver = new EnvironmentResolver(envDirectory, readFile);
		expect(
			await resolver.resolve("demo", [
				{ name: "TOKEN", secret: true },
				{ name: "EMPTY", secret: true },
			]),
		).toEqual([
			{ name: "TOKEN", value: " private#$\\token " },
			{ name: "EMPTY", value: "initial" },
		]);
		const stale = await fetch(url, {
			method: "PUT",
			headers,
			body: JSON.stringify({ revision: initial.revision, changes: [{ name: "TOKEN", value: "stale" }] }),
		});
		expect(stale.status).toBe(409);
		await scheduler.settle();
		expect(rollout).toHaveBeenCalledTimes(1);
		const merged = await fetch(url, {
			method: "PUT",
			headers,
			body: JSON.stringify({ revision: metadata.revision, changes: [{ name: "TOKEN", value: "replacement" }] }),
		});
		expect(merged.status).toBe(200);
		await scheduler.settle();
		expect(rollout).toHaveBeenCalledTimes(2);
		expect(await readFile(join(envDirectory, "demo.env"))).toContain("FUTURE='next-deployment'");
		const mergedMetadata = await merged.json();
		const removed = await fetch(url, {
			method: "PUT",
			headers,
			body: JSON.stringify({
				revision: mergedMetadata.revision,
				changes: [
					{ name: "EMPTY", value: "" },
					{ name: "FUTURE", value: "" },
				],
			}),
		});
		expect(removed.status).toBe(200);
		await scheduler.settle();
		expect(rollout).toHaveBeenCalledTimes(2);
		expect(await state.read("demo")).toMatchObject({ phase: "failed", activeRevision: "rev" });
		expect(await readFile(join(directory, "demo.state.yaml"))).not.toContain("replacement");
		expect((await removed.json()).variables).toEqual([
			{ name: "EMPTY", configured: false, used: true },
			{ name: "TOKEN", configured: true, used: true },
		]);
		expect(await readFile(join(envDirectory, "demo.env"))).not.toMatch(/EMPTY=|FUTURE=/);
		await expect(resolver.resolve("demo", [{ name: "EMPTY", secret: true }])).rejects.toMatchObject({
			details: { missingVariables: ["EMPTY"] },
		});
		await expect(
			new EnvironmentResolver(envDirectory, readFile).resolve("demo", [
				{ name: "A", secret: true },
				{ name: "B", secret: true },
			]),
		).rejects.toMatchObject({
			message: expect.stringContaining("Secrets"),
			details: { missingVariables: ["A", "B"] },
		});
	} finally {
		await scheduler.stop();
		await server.close();
		await rm(directory, { recursive: true, force: true });
	}
});
