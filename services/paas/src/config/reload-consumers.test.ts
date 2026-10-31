import { expect, test, vi } from "vitest";

import { PaasUiService } from "../frontend/paas-ui-service.ts";
import { AuthService } from "../ingress/auth/auth-service.ts";
import { JwtClient } from "../ingress/auth/jwt-client.ts";
import { GitHubOauth2Provider } from "../ingress/auth/oauth-provider/github.ts";
import { TlsCertProvisionService } from "../ingress/tls/cert-provision-service.ts";
import { DigitalOceanDnsAcmeChallengeProvider } from "../ingress/tls/dns-challenge/digitalocean-dns-challenge-provider.ts";
import { EventDiagnostics } from "../reconciler/event-diagnostics.ts";
import { ReconcilerService } from "../reconciler/reconciler-service.ts";
import { ResourceSpecification } from "../reconciler/resource-specification.ts";
import type { ReconciliationState } from "../reconciler/types.ts";
import { ResourceStatusService } from "../status/resource-status-service.ts";
import { PeriodicTaskRunner } from "../task/periodic.ts";
import { TestPaasConfig as PaasConfig, testConfigValue } from "../util/test/config.ts";
import { decodeDescriptorYaml } from "./paas-config.ts";
import type { PlatformConfig } from "./types.ts";

const fixture = async () => {
	let value = testConfigValue();
	const config = new PaasConfig(async () => JSON.stringify(value));
	await config.load();
	return {
		config,
		async update(change: Partial<PlatformConfig>) {
			value = { ...value, ...change };
			await config.reload();
		},
	};
};

test("existing authentication clients use reloaded credentials, allowlist and signing settings", async () => {
	const f = await fixture();
	const request = vi
		.fn<typeof fetch>()
		.mockImplementation(async () => Response.json({ access_token: "access", token_type: "bearer" }));
	const provider = new GitHubOauth2Provider(f.config, request);
	const tokens = new JwtClient(f.config, () => 10_000);
	const service = new AuthService(provider, tokens, f.config, () => "nonce", {
		getAll: async () => ({}),
		set: async () => {},
	});
	const old = tokens.issue({ userId: "Alice" }, "session");
	expect(service.verifyAuthCookie(old)).toEqual({ userId: "Alice" });
	const auth = f.config.getAuthConfig()!;
	await f.update({
		auth: {
			...auth,
			github: { ...auth.github, clientId: "new-id", clientSecret: "new-secret", allowedUsers: ["bob"] },
		},
	});
	expect(service.verifyAuthCookie(old)).toBeUndefined();
	expect(new URL(provider.getLoginUrl("state", "https://example.test/callback")).searchParams.get("client_id")).toBe(
		"new-id",
	);
	await provider.fetchAccessToken("code", "https://example.test/callback");
	const [, tokenRequest] = request.mock.calls.at(0)!;
	expect(JSON.parse(String(tokenRequest?.body))).toMatchObject({
		client_id: "new-id",
		client_secret: "new-secret",
	});
	await f.update({ auth: { ...auth, session: { ...auth.session, signingKey: "b".repeat(32), ttlSeconds: 60 } } });
	expect(tokens.verify(old, "session")).toBeUndefined();
	expect(service.verifyAuthCookie(tokens.issue({ userId: "Alice" }, "session"))).toEqual({ userId: "Alice" });
});

test("existing TLS clients read reloaded ACME email and DNS credentials", async () => {
	const f = await fixture();
	const provision = vi.fn(async () => ({ key: "key", cert: "cert" }));
	const service = new TlsCertProvisionService(f.config, { provision });
	const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 204 }));
	const dns = new DigitalOceanDnsAcmeChallengeProvider(f.config, request);
	const tls = f.config.getTlsConfig()!;
	await f.update({
		tls: {
			...tls,
			acme: { email: "new@example.test" },
			dns: { ...tls.dns, credentials: { apiToken: "new-token" } },
		},
	});
	await service.provisionCert();
	expect(provision).toHaveBeenCalledWith({ domains: ["example.test", "*.example.test"], email: "new@example.test" });
	await dns.removeChallenge({ zone: "example.test", id: 123 });
	const [, dnsRequest] = request.mock.calls.at(0)!;
	expect(dnsRequest?.headers).toMatchObject({ Authorization: "Bearer new-token" });
});

test("existing reconciler and UI discover reloaded service sources and retry bounds", async () => {
	const f = await fixture();
	const fetchFile = vi.fn(async () => ({
		revision: "revision",
		content: JSON.stringify({
			version: 1,
			metadata: { serviceId: "demo" },
			resources: { app: { type: "web", image: "app:1", ingress: { public: true, port: 80 } } },
		}),
	}));
	const states = new Map<string, ReconciliationState>();
	const state = {
		read: async (id: string) => states.get(id),
		write: async (id: string, value: ReconciliationState) => {
			states.set(id, value);
		},
	};
	const reconcile = vi.fn(async () => {});
	const service = new ReconcilerService(
		f.config,
		{ fetchFile },
		decodeDescriptorYaml,
		{ type: "web", lifecycle: "deployment", reconcile },
		state,
		() => 0,
		{ resolve: async () => [] },
		{ type: "worker", lifecycle: "deployment", reconcile },
		{ append: async () => {}, list: async () => [] },
		new EventDiagnostics(f.config),
	);
	const ui = new PaasUiService(
		new ResourceStatusService(new ResourceSpecification(), {
			resolve: async (_serviceId, env) =>
				env.map((entry) => ({ name: entry.name, value: "value" in entry ? entry.value : "test-secret" })),
		}),
		f.config,
		{ fetchFile, readCommit: vi.fn() },
		decodeDescriptorYaml,
		{
			listServiceContainers: async () => [],
			inspectServiceContainer: async () => null,
			readServiceContainerLogs: async () => "",
		},
		state,
		{ append: async () => {}, list: async () => [] },
		{ getStatus: () => "Missing" },
	);
	await service.reconcile();
	expect(fetchFile).not.toHaveBeenCalled();
	await f.update({
		services: { demo: { remote: "https://example.test/first.git", branch: "main", descriptorPath: "demo.yaml" } },
	});
	await service.reconcile();
	expect(fetchFile).toHaveBeenLastCalledWith(
		"demo",
		expect.objectContaining({ remote: "https://example.test/first.git" }),
	);
	expect(await ui.listServices()).toEqual([expect.objectContaining({ serviceId: "demo" })]);
	await f.update({
		services: { demo: { remote: "https://example.test/second.git", branch: "main", descriptorPath: "demo.yaml" } },
		reconciliation: { retryBackoffSeconds: 7, maxRetryBackoffSeconds: 9 },
	});
	await ui.getService("demo");
	expect(fetchFile).toHaveBeenLastCalledWith(
		"demo",
		expect.objectContaining({ remote: "https://example.test/second.git" }),
	);
	fetchFile.mockRejectedValueOnce(new Error("unavailable"));
	await service.reconcile();
	expect(states.get("demo")?.retryAt).toBe(7000);
	await f.update({ services: {} });
	expect(await ui.listServices()).toEqual([]);
	await expect(ui.getService("demo")).rejects.toMatchObject({ kind: "not-found" });
});

test("periodic reload reads disk again after each one-minute wait and stops with its lifecycle", async () => {
	let open = true;
	let value = testConfigValue();
	const read = vi.fn(async () => JSON.stringify(value));
	const config = new PaasConfig(read);
	await config.load();
	const waits: number[] = [];
	await new PeriodicTaskRunner({
		lifecycle: { isOpen: () => open, registerShutdownHandler() {}, async shutdown() {} },
		periodMs: 60_000,
		taskName: "config-reload",
		generateTaskId: () => "id",
		task: { run: () => config.reload() },
		report: (error) => {
			throw error;
		},
		pause: async (ms) => {
			waits.push(ms);
			if (waits.length === 1) value = { ...value, git: { ...value.git, pollIntervalSeconds: 9 } };
			else open = false;
		},
	}).start();
	expect(waits).toEqual([60_000, 60_000]);
	expect(config.getGitConfig().pollIntervalSeconds).toBe(9);
	expect(read).toHaveBeenCalledTimes(3);
});
