import acme from "acme-client";
import { expect, test } from "vitest";

import { createLogger } from "../../util/logger.ts";
import { testConfig } from "../../util/test/config.ts";
import { AcmeAccountStore } from "./acme-account-store.ts";
import { AcmeClient } from "./acme-client.ts";
import { TlsCertProvisionService } from "./cert-provision-service.ts";
import { TlsCertRenewalTask } from "./cert-renewal-task.ts";
import { FileCertificateStore } from "./certificate-store.ts";
import { DigitalOceanDnsAcmeChallengeProvider } from "./dns-challenge/digitalocean-dns-challenge-provider.ts";

test("renewal diagnostics retain the complete account-storage cause chain", async () => {
	const original = Object.assign(new Error("permission denied: /state/acme-account.pem"), { code: "EACCES" });
	const account = new AcmeAccountStore({
		get: async () => {
			throw original;
		},
		set: async () => {},
		update: async () => {},
		delete: async () => {},
	});
	const task = new TlsCertRenewalTask(
		new TlsCertProvisionService(
			testConfig({
				ingress: { ...testConfig().getIngressConfig(), baseDomain: "example.com" },
				tls: { ...testConfig().getTlsConfig()!, acme: { email: "admin@example.com" } },
			}),
			new AcmeClient(
				{ createChallenge: async () => ({ zone: "example.com", id: 1 }), removeChallenge: async () => {} },
				account,
				acme,
			),
		),
		{ read: async () => undefined, publish: async () => {} },
		() => new Date(0),
	);
	const failure = await task.run().catch((error: unknown) => error);
	expect(failure).toMatchObject({ cause: { cause: { cause: original } } });
	const lines: string[] = [];
	createLogger("test", { write: (line: string) => lines.push(line) }).error({ err: failure }, "Renewal failed");
	const record = JSON.parse(lines.at(0)!);
	expect(record.err.stack).toContain("caused by: Error: permission denied");
	expect(record.err.cause.cause.cause.code).toBe("EACCES");
});

test.each(["read", "write"])("ACME account %s preserves the storage failure", async (operation) => {
	const cause = new Error("disk failure");
	const store = new AcmeAccountStore({
		get: async () => {
			throw cause;
		},
		set: async () => {
			throw cause;
		},
		update: async () => {},
		delete: async () => {},
	});
	await expect(operation === "read" ? store.readAccountKey() : store.writeAccountKey("key")).rejects.toMatchObject({
		cause,
	});
});

test("certificate reads and invalid publication preserve their causes", async () => {
	const cause = new Error("read failed");
	const store = new FileCertificateStore(
		"/state",
		async () => {
			throw cause;
		},
		async () => {},
	);
	await expect(store.read()).rejects.toMatchObject({ cause: { cause } });
	await expect(store.publish({ cert: "invalid", key: "invalid" })).rejects.toMatchObject({
		cause: expect.any(Error),
	});
});

test.each(["create", "remove"])("DNS challenge %s preserves network failures", async (operation) => {
	const cause = new Error("connection refused");
	const provider = new DigitalOceanDnsAcmeChallengeProvider(
		testConfig({
			ingress: { ...testConfig().getIngressConfig(), baseDomain: "example.com" },
			tls: {
				...testConfig().getTlsConfig()!,
				dns: { provider: "digitalocean", credentials: { apiToken: "token" } },
			},
		}),
		async () => {
			throw cause;
		},
	);
	await expect(
		operation === "create"
			? provider.createChallenge("example.com", "value")
			: provider.removeChallenge({ zone: "example.com", id: 1 }),
	).rejects.toMatchObject({ cause });
});

test.each([401, 403, 429, 500])("DNS diagnostics retain HTTP status %s", async (status) => {
	const provider = new DigitalOceanDnsAcmeChallengeProvider(
		testConfig({
			ingress: { ...testConfig().getIngressConfig(), baseDomain: "example.com" },
			tls: {
				...testConfig().getTlsConfig()!,
				dns: { provider: "digitalocean", credentials: { apiToken: "token" } },
			},
		}),
		async () => new Response("provider failure details", { status }),
	);
	await expect(provider.createChallenge("example.com", "value")).rejects.toMatchObject({
		cause: { message: expect.stringContaining(`HTTP ${status}: provider failure details`) },
	});
	await expect(provider.removeChallenge({ zone: "example.com", id: 1 })).rejects.toMatchObject({
		cause: { message: expect.stringContaining(`HTTP ${status}: provider failure details`) },
	});
});
