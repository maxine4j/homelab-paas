import { tmpdir } from "node:os";
import { join } from "node:path";

import Koa from "koa";
import { expect, test, vi } from "vitest";

import { FileConfigStore } from "../../src/config/config-store.ts";
import { PaasConfig, decodeDescriptorYaml } from "../../src/config/paas-config.ts";
import { ChangeBus } from "../../src/events/change-bus.ts";
import { createPaasUiRouter } from "../../src/frontend/paas-ui-router.ts";
import { PaasUiService } from "../../src/frontend/paas-ui-service.ts";
import { JwtClient } from "../../src/ingress/auth/jwt-client.ts";
import { DesiredInputs } from "../../src/reconciler/desired-inputs.ts";
import { EventDiagnostics } from "../../src/reconciler/event-diagnostics.ts";
import { ReconcilerService } from "../../src/reconciler/reconciler-service.ts";
import { ReconciliationScheduler } from "../../src/reconciler/reconciliation-scheduler.ts";
import { ReconciliationStore } from "../../src/reconciler/reconciliation-store.ts";
import { ResourceSpecification } from "../../src/reconciler/resource-specification.ts";
import { ResourceStatusService } from "../../src/status/resource-status-service.ts";
import { FileSystemKeyValueStore } from "../../src/store/file-system-store.ts";
import { atomicWriteFile, mkdtemp, readFile, rm, stat } from "../../src/util/file.ts";
import { sleep } from "../../src/util/sleep.ts";
import { testConfigValue } from "../../src/util/test/config.ts";
import { startTestApi } from "../../src/util/test/router.ts";
import { parseYaml, stringifyYaml } from "../../src/util/yaml.ts";

test("authenticated config edits persist on disk and update existing JWT and service consumers", async () => {
	const directory = await mkdtemp(join(tmpdir(), "paas-config-edit-"));
	const path = join(directory, "config.yaml");
	await atomicWriteFile(path, stringifyYaml(testConfigValue()));
	const changes = new ChangeBus();
	const config = new PaasConfig(
		new FileConfigStore(
			() => readFile(path),
			(_path, data, options) => atomicWriteFile(path, data, options),
		),
		{},
		changes,
	);
	await config.load();
	const fetchFile = vi.fn(async () => ({
		revision: "revision",
		content: JSON.stringify({
			version: 1,
			metadata: { serviceId: "demo" },
			resources: { app: { type: "web", image: "app:1", ingress: { public: true, port: 80 } } },
		}),
	}));
	const inputs = new DesiredInputs(config, { fetchFile }, decodeDescriptorYaml, { resolve: async () => [] });
	const state = new ReconciliationStore(
		new FileSystemKeyValueStore<unknown>(
			directory,
			readFile,
			atomicWriteFile,
			(path) => rm(path, { force: true }),
			"yaml",
		),
	);
	const rollout = vi.fn(async () => {});
	const reconciler = new ReconcilerService(
		config,
		inputs,
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
		inputs,
		sleep,
		Date.now,
		() => "config-api",
		changes,
	);
	await scheduler.start();
	const tokens = new JwtClient(config, Date.now);
	const token = tokens.issue({ userId: "Alice" }, "session");
	const ui = new PaasUiService(
		new ResourceStatusService(new ResourceSpecification(), {
			resolve: async (_serviceId, env) =>
				env.map((entry) => ({ name: entry.name, value: "value" in entry ? entry.value : "test-secret" })),
		}),
		config,
		{ fetchFile: vi.fn(), readCommit: vi.fn() },
		decodeDescriptorYaml,
		{
			listServiceContainers: vi.fn(async () => []),
			inspectServiceContainer: vi.fn(),
			readServiceContainerLogs: vi.fn(),
		},
		{ read: async () => undefined, write: vi.fn() },
		{ append: async () => {}, list: async () => [] },
		{ getStatus: vi.fn(), refineStatus: vi.fn() },
	);
	const router = createPaasUiRouter(
		ui,
		{ refreshOne: vi.fn(), refreshAll: vi.fn() },
		{
			verifyAuthCookie: (token) => {
				const userId = tokens.verify(token ?? "", "session")?.userId;
				return userId ? { userId } : undefined;
			},
		},
	);
	const server = await startTestApi(new Koa().use(router.routes()).use(router.allowedMethods()));
	try {
		const snapshot = config.getEditableConfig();
		const response = await fetch(`${server.origin}/api/ui/cluster/config`, {
			method: "PUT",
			headers: {
				origin: server.origin,
				"content-type": "application/json",
				"x-paas-config": "1",
				cookie: `__Secure-paas_session=${token}`,
			},
			body: JSON.stringify({
				revision: snapshot.revision,
				changes: [
					{
						path: "services",
						value: {
							demo: { remote: "https://example.test/demo.git", accessToken: "repository-access-token" },
						},
					},
					{ path: "auth.session.signingKey", value: "new-key-".repeat(8) },
				],
			}),
		});
		expect(response.status).toBe(200);
		await scheduler.settle();
		expect(rollout).toHaveBeenCalledTimes(1);
		expect(fetchFile).toHaveBeenCalledWith(
			"demo",
			expect.objectContaining({
				remote: "https://example.test/demo.git",
				accessToken: "repository-access-token",
			}),
		);
		expect(await state.read("demo")).toEqual({
			desiredRevision: "revision",
			activeRevision: "revision",
			phase: "ready",
		});
		expect(await readFile(join(directory, "demo.state.yaml"))).not.toContain("repository-access-token");
		const savedResponse = await response.text();
		expect(savedResponse).not.toContain("new-key-");
		expect(savedResponse).not.toContain("repository-access-token");
		expect(config.getEditableConfig().fields.find((field) => field.path === "services")?.readOnly).toBe(false);
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		expect(parseYaml((await readFile(path))!, "saved config")).toMatchObject({
			auth: { session: { signingKey: "new-key-".repeat(8) } },
			services: { demo: { accessToken: "repository-access-token" } },
		});
		expect(await ui.listServices()).toEqual([{ serviceId: "demo", sync: "Unknown", health: "Unknown" }]);
		expect(tokens.verify(token, "session")).toBeUndefined();
		const denied = await fetch(`${server.origin}/api/ui/cluster`, {
			headers: { cookie: `__Secure-paas_session=${token}` },
		});
		expect(denied.status).toBe(401);
		await denied.body?.cancel();
		const reloaded = new PaasConfig(new FileConfigStore(() => readFile(path), vi.fn()));
		await reloaded.load();
		expect(reloaded.getServices()).toEqual(config.getServices());
		expect(reloaded.getAuthConfig()).toEqual(config.getAuthConfig());
	} finally {
		await scheduler.stop();
		await server.close();
		await rm(directory, { recursive: true, force: true });
	}
});
