import { expect, test } from "vitest";

import { PaasConfig, decodeDescriptorYaml, parseConfig } from "../config/paas-config.ts";
import { DockerClient } from "../docker/docker-client.ts";
import { EnvoyClient } from "../envoy/envoy-client.ts";
import { GitClient } from "../git/git-client.ts";
import { GitHubOauth2Provider } from "../ingress/auth/oauth-provider/github.ts";
import { EnvironmentResolver } from "../reconciler/environment-resolver.ts";
import { EndpointsStore } from "../reconciler/networking/endpoints-store.ts";
import { ReconciliationStore } from "../reconciler/reconciliation-store.ts";
import { testConfig } from "../util/test/config.ts";
import { DomainError } from "./error.ts";
import { parseYaml } from "./yaml.ts";

const cause = Object.assign(new Error("original infrastructure failure"), { code: "EACCES" });
const fail = async (): Promise<never> => {
	throw cause;
};
const values = { get: fail, set: fail, update: fail, delete: fail };
const envoy = new EnvoyClient(
	{ createDiscoveryFile: fail, writeDiscoveryFile: fail, readConfigDump: fail },
	async () => {},
	{ attempts: 1, intervalMs: 0 },
);
const github = new GitHubOauth2Provider(
	testConfig({
		auth: {
			...testConfig().getAuthConfig()!,
			github: { ...testConfig().getAuthConfig()!.github, ...{ clientId: "id", clientSecret: "secret" } },
		},
	}),
	fail,
);

test.each([
	["configuration", () => new PaasConfig(fail).load()],
	["Git", () => new GitClient({ execute: fail, createDirectory: fail, realPath: fail }).initRepo("/repo")],
	["Docker", () => new DockerClient({ request: fail }).inspectNetwork("network")],
	["Envoy bootstrap", () => envoy.bootstrap()],
	["Envoy apply", () => envoy.apply({ clusters: [], listeners: [] })],
	["state read", () => new ReconciliationStore(values).read("demo")],
	["state write", () => new ReconciliationStore(values).write("demo", { phase: "ready" })],
	["routes read", () => new EndpointsStore(values).getAll()],
	["routes write", () => new EndpointsStore({ ...values, get: async () => ({}) }).set("demo", undefined)],
	["environment", () => new EnvironmentResolver("/env", fail).resolve("demo", [{ name: "TOKEN", secret: true }])],
	["GitHub token", () => github.fetchAccessToken("code", "https://example.com/callback")],
	["GitHub profile", () => github.fetchUserDetails("token")],
] as const)("%s retains the original infrastructure cause", async (_name, run) => {
	await expect(run()).rejects.toMatchObject({ cause });
});

test("Docker decode failures retain parsing details", async () => {
	const docker = new DockerClient({ request: async () => ({ status: 200, body: "invalid JSON" }) });
	await expect(docker.inspectNetwork("network")).rejects.toMatchObject({ cause: expect.any(SyntaxError) });
});

test("YAML and descriptor failures retain parser details behind contextual errors", () => {
	for (const parse of [
		() => parseYaml("token: [invalid", "input.yaml"),
		() => decodeDescriptorYaml("token: [invalid", "demo"),
	]) {
		try {
			parse();
			throw new Error("Expected parsing failure");
		} catch (error) {
			expect(error).toMatchObject({ cause: expect.any(Error) });
		}
	}
});

test("DomainError retains the original cause rather than wrapping it in an options object", () => {
	expect(new DomainError("failed", { resourceId: "web" }, cause).cause).toBe(cause);
});

test("configuration schema diagnostics retain field-level validation errors", () => {
	expect(() => parseConfig({ version: "invalid" })).toThrow(expect.objectContaining({ cause: expect.any(Error) }));
});

test("Docker HTTP and pull failures retain provider diagnostics", async () => {
	const docker = new DockerClient({ request: async () => ({ status: 500, body: "engine failure details" }) });
	await expect(docker.startContainer("id")).rejects.toMatchObject({
		cause: { message: expect.stringContaining("HTTP 500: engine failure details") },
	});
	const pull = new DockerClient({
		request: async () => ({
			status: 200,
			body: JSON.stringify({ errorDetail: { message: "pull failure details" } }),
		}),
	});
	await expect(pull.pullImage("app:1")).rejects.toMatchObject({
		cause: { message: expect.stringContaining("pull failure details") },
	});
});

test("Envoy polling exhaustion retains the last connection failure", async () => {
	const client = new EnvoyClient(
		{ createDiscoveryFile: async () => {}, writeDiscoveryFile: async () => {}, readConfigDump: fail },
		async () => {},
		{ attempts: 2, intervalMs: 0 },
	);
	await expect(client.apply({ clusters: [], listeners: [] })).rejects.toMatchObject({ cause: { cause } });
});

test.each(["token", "profile"])("GitHub %s failures retain HTTP response diagnostics", async (operation) => {
	const provider = new GitHubOauth2Provider(
		testConfig({
			auth: {
				...testConfig().getAuthConfig()!,
				github: { ...testConfig().getAuthConfig()!.github, ...{ clientId: "id", clientSecret: "secret" } },
			},
		}),
		async () => new Response("GitHub failure details", { status: 500 }),
	);
	await expect(
		operation === "token"
			? provider.fetchAccessToken("code", "https://example.com/callback")
			: provider.fetchUserDetails("token"),
	).rejects.toMatchObject({ cause: { message: expect.stringContaining("HTTP 500: GitHub failure details") } });
});
