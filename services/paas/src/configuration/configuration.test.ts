import { expect, test } from "vitest";

import { Configuration, decodeDescriptorYaml, parseConfig } from "./configuration.ts";

const descriptor = {
	version: 1,
	metadata: { serviceId: "test-service" },
	resources: { app: { type: "web", image: "test-service:local", ingress: { public: true, port: 8080 } } },
};

test("loads the fixed configuration file and sanitizes YAML and filesystem failures", async () => {
	const paths: string[] = [];
	const configuration = new Configuration(async (path) => {
		paths.push(path);
		return "invalid: [secret";
	});
	await expect(configuration.load()).rejects.toThrow("Cannot load platform configuration");
	expect(paths).toEqual(["/etc/homelab-paas/config.yaml"]);
	await expect(
		new Configuration(async () => {
			throw new Error("secret");
		}).load(),
	).rejects.toThrow("Cannot load platform configuration");
	expect(decodeDescriptorYaml(JSON.stringify(descriptor), "test-service").metadata.serviceId).toBe("test-service");
	expect(() => decodeDescriptorYaml("env: [secret", "test-service")).toThrow("Invalid service descriptor");
});

test("defaults remote branches, requires absolute local paths and rejects incomplete authentication", () => {
	const config = {
		version: 1,
		metadata: { clusterId: "local" },
		ingress: { baseDomain: "localhost", httpPort: 80 },
		git: { pollIntervalSeconds: 5, operationTimeoutSeconds: 60 },
		reconciliation: { retryBackoffSeconds: 5, maxRetryBackoffSeconds: 60 },
		services: { demo: { remote: "https://example.com/repo.git" } },
	};
	expect(parseConfig(config).services["demo"]).toEqual({
		remote: "https://example.com/repo.git",
		branch: "main",
		descriptorPath: "demo.sd.yaml",
	});
	expect(() =>
		parseConfig({ ...config, services: { demo: { remote: "local", descriptorPath: "demo.sd.yaml" } } }),
	).toThrow("Invalid platform configuration");
	expect(() => parseConfig({ ...config, auth: {} })).toThrow("Invalid platform configuration");
	expect(
		parseConfig({ ...config, services: { demo: { remote: "local", descriptorPath: "/mnt/repo/demo.sd.yaml" } } })
			.services["demo"]?.remote,
	).toBe("local");
});

test("accepts paired auth/TLS configuration, validates secrets and fixes the GitHub callback origin", () => {
	const value = {
		version: 1,
		metadata: { clusterId: "prod" },
		ingress: { baseDomain: "apps.example.com" },
		git: { pollIntervalSeconds: 5, operationTimeoutSeconds: 60 },
		reconciliation: { retryBackoffSeconds: 5, maxRetryBackoffSeconds: 60 },
		services: {},
		auth: {
			github: {
				clientId: "id",
				clientSecret: "secret",
				callbackUrl: "https://auth.apps.example.com/oauth/github/callback",
				allowedUsers: ["alice"],
			},
			session: { issuer: "paas", audience: "paas", signingKey: "a".repeat(32), ttlSeconds: 3600 },
		},
		tls: {
			acme: { email: "admin@example.com" },
			dns: { provider: "digitalocean", credentials: { apiToken: "token" } },
		},
	};
	expect(parseConfig(value).ingress.httpsPort).toBe(443);
	for (const change of [
		{ tls: undefined },
		{ auth: undefined },
		{ ingress: { baseDomain: "apps.example.com", httpsPort: 80 } },
		{ auth: { ...value.auth, github: { ...value.auth.github, callbackUrl: "https://evil.test/callback" } } },
		{ auth: { ...value.auth, session: { ...value.auth.session, signingKey: "short" } } },
	]) {
		expect(() => parseConfig({ ...value, ...change })).toThrow("Invalid platform configuration");
	}
});
