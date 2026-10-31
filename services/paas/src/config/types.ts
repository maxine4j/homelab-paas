import type { GitFileSource } from "../git/types.ts";

export interface ConfigDocument {
	value: unknown;
	revision: string;
}

export interface PlatformConfig {
	version: 1;
	metadata: { clusterId: string };
	ingress: { baseDomain: string; httpPort: number; httpsPort?: number };
	auth?: {
		github: { clientId: string; clientSecret: string; allowedUsers: string[] };
		session: { issuer: string; audience: string; signingKey: string; ttlSeconds: number };
	};
	tls?: {
		acme: { email: string };
		dns: { provider: "digitalocean"; credentials: { apiToken: string } };
	};
	git: { pollIntervalSeconds: number; operationTimeoutSeconds: number };
	reconciliation: { retryBackoffSeconds: number; maxRetryBackoffSeconds: number };
	services: Record<string, GitFileSource>;
}
export interface SecretDocument {
	revision: string;
	values: Map<string, string>;
}
