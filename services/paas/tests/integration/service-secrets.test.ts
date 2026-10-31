import { tmpdir } from "node:os";
import { join } from "node:path";

import Koa from "koa";
import { expect, test, vi } from "vitest";

import { decodeDescriptorYaml } from "../../src/config/paas-config.ts";
import { SecretStore } from "../../src/config/secret-store.ts";
import { ServiceSecrets } from "../../src/config/service-secrets.ts";
import { createPaasUiRouter } from "../../src/frontend/paas-ui-router.ts";
import { PaasUiService } from "../../src/frontend/paas-ui-service.ts";
import { JwtClient } from "../../src/ingress/auth/jwt-client.ts";
import { EnvironmentResolver } from "../../src/reconciler/environment-resolver.ts";
import { ResourceSpecification } from "../../src/reconciler/resource-specification.ts";
import { ResourceStatusService } from "../../src/status/resource-status-service.ts";
import { atomicWriteFile, chmod, mkdir, mkdtemp, readFile, rm, stat, type FileWriter } from "../../src/util/file.ts";
import { testConfig } from "../../src/util/test/config.ts";
import { startTestApi } from "../../src/util/test/router.ts";

test("authenticated secret editing persists private files, retains values, resolves runtime env and rejects stale writes", async () => {
	const directory = await mkdtemp(join(tmpdir(), "paas-secrets-"));
	const envDirectory = join(directory, "env");
	const config = testConfig({ services: { demo: { remote: "local", descriptorPath: "/repo/demo.yaml" } } });
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
	);
	const ui = new PaasUiService(
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
		{ getStatus: vi.fn() },
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
			{ name: "EMPTY", value: "" },
			{ name: "FUTURE", value: "next-deployment" },
		];
		const saved = await fetch(url, {
			method: "PUT",
			headers,
			body: JSON.stringify({ revision: initial.revision, changes }),
		});
		expect(saved.status).toBe(200);
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
			{ name: "EMPTY", value: "" },
		]);
		const stale = await fetch(url, {
			method: "PUT",
			headers,
			body: JSON.stringify({ revision: initial.revision, changes: [{ name: "TOKEN", value: "stale" }] }),
		});
		expect(stale.status).toBe(409);
		const merged = await fetch(url, {
			method: "PUT",
			headers,
			body: JSON.stringify({ revision: metadata.revision, changes: [{ name: "TOKEN", value: "replacement" }] }),
		});
		expect(merged.status).toBe(200);
		expect(await readFile(join(envDirectory, "demo.env"))).toContain("FUTURE='next-deployment'");
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
		await server.close();
		await rm(directory, { recursive: true, force: true });
	}
});
