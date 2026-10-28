import type { JsonValue } from "@homelab-paas/shared-contracts";

import { FileConfigStore } from "../../config/config-store.ts";
import type { IPaasConfig } from "../../config/paas-config.ts";
import { PaasConfig } from "../../config/paas-config.ts";
import type { PlatformConfig } from "../../config/types.ts";
import type { FileReader, FileWriter } from "../file.ts";

export const createTestPaasConfig = (
	read: FileReader,
	environment: Readonly<Record<string, string | undefined>> = {},
	write: FileWriter = async () => {
		throw new Error("Unexpected configuration write");
	},
): PaasConfig => new PaasConfig(new FileConfigStore(read, write), environment);

/** Retains concise file-reader fixtures while exercising the real store and service. */
export class TestPaasConfig extends PaasConfig {
	constructor(read: FileReader, environment: Readonly<Record<string, string | undefined>> = {}) {
		super(
			new FileConfigStore(read, async () => {
				throw new Error("Unexpected configuration write");
			}),
			environment,
		);
	}
}

/** Mutable configuration source for testing consumers across reloads. */
export const testConfigValue = (overrides: Partial<PlatformConfig> = {}): PlatformConfig => {
	const value: PlatformConfig = {
		version: 1,
		metadata: { clusterId: "local" },
		ingress: { baseDomain: "example.test", httpPort: 80, httpsPort: 443 },
		auth: {
			github: { clientId: "id", clientSecret: "secret", allowedUsers: ["Alice"] },
			session: { issuer: "paas", audience: "paas", signingKey: "a".repeat(32), ttlSeconds: 3600 },
		},
		tls: {
			acme: { email: "admin@example.com" },
			dns: { provider: "digitalocean", credentials: { apiToken: "token" } },
		},
		git: { pollIntervalSeconds: 5, operationTimeoutSeconds: 60 },
		reconciliation: { retryBackoffSeconds: 1, maxRetryBackoffSeconds: 4 },
		services: {},
		...overrides,
	};
	return value;
};

/** Mutable consumer fixture; configuration policy is tested against PaasConfig itself. */
export const testConfig = (
	overrides: Partial<PlatformConfig> = {},
	environment: Readonly<Record<string, string | undefined>> = {},
): IPaasConfig => {
	const value = testConfigValue(overrides);
	const redact = (text: string, additional: string[] = []): string => {
		for (const secret of [
			value.auth?.github.clientSecret,
			value.auth?.session.signingKey,
			value.tls?.dns.credentials.apiToken,
			...additional,
		]
			.filter((entry): entry is string => Boolean(entry))
			.sort((a, b) => b.length - a.length))
			text = text.replaceAll(secret, "[redacted]");
		return text.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[redacted]@");
	};
	const sanitize = (entry: unknown, secrets: string[] = [], key = ""): JsonValue => {
		if (/secret|password|token|signingkey|command|credentials/i.test(key)) return "[redacted]";
		if (typeof entry === "string") return redact(entry, secrets);
		if (typeof entry === "number" || typeof entry === "boolean" || entry === null) return entry;
		if (Array.isArray(entry)) return entry.map((value) => sanitize(value, secrets));
		if (typeof entry === "object")
			return Object.fromEntries(
				Object.entries(entry)
					.filter(([, value]) => value !== undefined)
					.map(([key, value]) => [key, sanitize(value, secrets, key)]),
			);
		return null;
	};
	const source: IPaasConfig = {
		getClusterId: () => value.metadata.clusterId,
		getIngressConfig: () => value.ingress,
		getAuthConfig: () => value.auth,
		getTlsConfig: () => value.tls,
		getGitConfig: () => ({ fetchIntervalSeconds: 300, ...value.git }),
		getGitEnvironment: () => environment,
		getReconciliationConfig: () => value.reconciliation,
		getServices: () => value.services,
		getEditableConfig: () => ({ config: sanitize(value), revision: "fixture", fields: [] }),
		updateConfig: async () => {
			throw new Error("Unexpected configuration update");
		},
		redact,
		sanitize,
	};
	return source;
};
