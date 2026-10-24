import type { IPaasConfig } from "../../config/paas-config.ts";
import type { PlatformConfig } from "../../config/types.ts";

/** Mutable configuration source for testing consumers across reloads. */
export const testConfig = (
	overrides: Partial<PlatformConfig> = {},
	environment: Readonly<Record<string, string | undefined>> = {},
): IPaasConfig => {
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
	return {
		getClusterId: () => value.metadata.clusterId,
		getIngressConfig: () => value.ingress,
		getAuthConfig: () => value.auth,
		getTlsConfig: () => value.tls,
		getGitConfig: () => value.git,
		getGitEnvironment: () => environment,
		getReconciliationConfig: () => value.reconciliation,
		getServices: () => value.services,
		getConfig: () => value,
	};
};
