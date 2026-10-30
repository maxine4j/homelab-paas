import { tmpdir } from "node:os";
import { join } from "node:path";

import Koa from "koa";
import { expect, test, vi } from "vitest";

import { FileConfigStore } from "../../src/config/config-store.ts";
import { PaasConfig, decodeDescriptorYaml } from "../../src/config/paas-config.ts";
import { createPaasUiRouter } from "../../src/frontend/paas-ui-router.ts";
import { PaasUiService } from "../../src/frontend/paas-ui-service.ts";
import { JwtClient } from "../../src/ingress/auth/jwt-client.ts";
import { atomicWriteFile, mkdtemp, readFile, rm, stat } from "../../src/util/file.ts";
import { testConfigValue } from "../../src/util/test/config.ts";
import { startTestApi } from "../../src/util/test/router.ts";
import { parseYaml, stringifyYaml } from "../../src/util/yaml.ts";

test("authenticated config edits persist on disk and update existing JWT and service consumers", async () => {
	const directory = await mkdtemp(join(tmpdir(), "paas-config-edit-"));
	const path = join(directory, "config.yaml");
	await atomicWriteFile(path, stringifyYaml(testConfigValue()));
	const config = new PaasConfig(
		new FileConfigStore(
			() => readFile(path),
			(_path, data, options) => atomicWriteFile(path, data, options),
		),
	);
	await config.load();
	const tokens = new JwtClient(config, Date.now);
	const token = tokens.issue({ userId: "Alice" }, "session");
	const ui = new PaasUiService(
		config,
		{ fetchFile: vi.fn(), readCommit: vi.fn() },
		decodeDescriptorYaml,
		{ listServiceContainers: vi.fn(), inspectServiceContainer: vi.fn(), readServiceContainerLogs: vi.fn() },
		{ read: async () => undefined, write: vi.fn() },
		{ append: async () => {}, list: async () => [] },
		{ getStatus: vi.fn() },
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
		const savedResponse = await response.text();
		expect(savedResponse).not.toContain("new-key-");
		expect(savedResponse).not.toContain("repository-access-token");
		expect(config.getEditableConfig().fields.find((field) => field.path === "services")?.readOnly).toBe(false);
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		expect(parseYaml((await readFile(path))!, "saved config")).toMatchObject({
			auth: { session: { signingKey: "new-key-".repeat(8) } },
			services: { demo: { accessToken: "repository-access-token" } },
		});
		expect(await ui.listServices()).toEqual([{ serviceId: "demo", phase: "unknown" }]);
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
		await server.close();
		await rm(directory, { recursive: true, force: true });
	}
});
