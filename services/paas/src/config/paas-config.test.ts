import { expect, test } from "vitest";

import { TestPaasConfig as PaasConfig } from "../util/test/config.ts";
import { captureLogs } from "../util/test/logs.ts";
import { decodeDescriptorYaml, parseConfig } from "./paas-config.ts";

const descriptor = {
	version: 1,
	metadata: { serviceId: "test-service" },
	resources: { app: { type: "web", image: "test-service:local", ingress: { public: true, port: 8080 } } },
};

test("repository credentials are optional and must match the remote protocol", () => {
	const base = {
		version: 1,
		metadata: { clusterId: "local" },
		ingress: { baseDomain: "localhost" },
		git: { pollIntervalSeconds: 5, operationTimeoutSeconds: 60 },
		reconciliation: { retryBackoffSeconds: 5, maxRetryBackoffSeconds: 60 },
	};
	const parse = (source: Record<string, unknown>) => parseConfig({ ...base, services: { demo: source } });
	for (const remote of ["https://example.com/repo", "ssh://git@example.com/repo", "git@example.com:org/repo"])
		expect(parse({ remote }).services["demo"]?.remote).toBe(remote);
	expect(parse({ remote: "https://example.com/repo", accessToken: "private-token" }).services["demo"]).toHaveProperty(
		"accessToken",
		"private-token",
	);
	for (const remote of ["ssh://git@example.com/repo", "git@example.com:org/repo"])
		expect(parse({ remote, privateKeyPath: "/arbitrary/host/key" }).services["demo"]).toHaveProperty(
			"privateKeyPath",
			"/arbitrary/host/key",
		);
	for (const source of [
		{ remote: "https://example.com/repo", privateKeyPath: "/key" },
		{ remote: "git@example.com:org/repo", accessToken: "private-token" },
		{ remote: "ssh://git@example.com/repo", accessToken: "private-token" },
		{ remote: "local", descriptorPath: "/repo/file", accessToken: "private-token" },
		{ remote: "/repo", privateKeyPath: "/key" },
		{ remote: "http://example.com/repo", accessToken: "private-token" },
		{ remote: "ssh://git@example.com/repo", privateKeyPath: "relative/key" },
		{ remote: "https://example.com/repo", accessToken: "" },
		{ remote: "https://example.com/repo", accessToken: "bad\nheader" },
	])
		expect(() => parse(source)).toThrow("Invalid platform configuration");
});

test("resolves only resource image tags using the descriptor commit", () => {
	const value = {
		...descriptor,
		resources: Object.fromEntries(
			["web", "worker", "postgres", "rabbitmq"].map((type) => [
				type,
				{
					type,
					image: "app:${COMMIT_ID:7}",
					...(type === "web" ? { ingress: { public: true, port: 8080 } } : {}),
					...(type === "worker" ? { healthcheckPort: 8080 } : {}),
					...(type === "web" || type === "worker"
						? { env: [{ name: "LITERAL", value: "${COMMIT_ID:7}" }] }
						: {}),
				},
			]),
		),
	};
	const parsed = decodeDescriptorYaml(
		JSON.stringify(value),
		"test-service",
		"abcdef0123456789abcdef0123456789abcdef01",
	);
	expect(Object.values(parsed.resources).map((resource) => resource.image)).toEqual(Array(4).fill("app:abcdef0"));
	expect(parsed.resources["web"]).toMatchObject({ env: [{ name: "LITERAL", value: "${COMMIT_ID:7}" }] });
	expect(() => decodeDescriptorYaml(JSON.stringify(value), "test-service")).toThrow("Invalid service descriptor");
});

test("loads the fixed configuration file and sanitizes YAML and filesystem failures", async () => {
	const paths: string[] = [];
	const configuration = new PaasConfig(async (path) => {
		paths.push(path);
		return "invalid: [secret";
	});
	await expect(configuration.load()).rejects.toThrow("Cannot load platform configuration");
	expect(paths).toEqual(["/etc/homelab-paas/config.yaml"]);
	await expect(
		new PaasConfig(async () => {
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

const authenticatedConfig = {
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
			allowedUsers: ["alice"],
		},
		session: { issuer: "paas", audience: "paas", signingKey: "a".repeat(32), ttlSeconds: 3600 },
	},
	tls: {
		acme: { email: "admin@example.com" },
		dns: { provider: "digitalocean", credentials: { apiToken: "token" } },
	},
};

test("reload publishes validated settings atomically and getters return independent values", async () => {
	let content = JSON.stringify(authenticatedConfig);
	const configuration = new PaasConfig(async () => content);
	await configuration.load();
	expect(configuration.getTlsConfig()?.acme.email).toBe("admin@example.com");
	content = JSON.stringify({ ...authenticatedConfig, services: { demo: { remote: "https://example.com/demo" } } });
	await configuration.reload();
	expect(configuration.getServices()["demo"]?.branch).toBe("main");
	const services = configuration.getServices();
	delete services["demo"];
	expect(configuration.getServices()["demo"]).toBeDefined();
});

test.each(["missing", "unreadable", "syntax", "schema"])(
	"failed %s reload retains settings, logs the cause and recovers",
	async (failure) => {
		let content: string | undefined = JSON.stringify(authenticatedConfig);
		let unreadable = false;
		const configuration = new PaasConfig(async () => {
			if (unreadable) throw new Error("permission denied");
			return content;
		});
		await configuration.load();
		content = failure === "missing" ? undefined : failure === "syntax" ? "invalid: [" : "version: 9";
		unreadable = failure === "unreadable";
		const capture = captureLogs();
		try {
			await configuration.reload();
		} finally {
			capture.restore();
		}
		expect(configuration.getTlsConfig()?.acme.email).toBe("admin@example.com");
		expect(capture.lines.map((line) => JSON.parse(line))).toEqual(
			expect.arrayContaining([expect.objectContaining({ level: 50, err: expect.anything() })]),
		);
		unreadable = false;
		content = JSON.stringify({
			...authenticatedConfig,
			tls: { ...authenticatedConfig.tls, acme: { email: "new@example.com" } },
		});
		await configuration.reload();
		expect(configuration.getTlsConfig()?.acme.email).toBe("new@example.com");
	},
);

test("reload reapplies environment overrides and rejects changes requiring a restart", async () => {
	let value = authenticatedConfig;
	const configuration = new PaasConfig(async () => JSON.stringify(value), { ACME_EMAIL: "override@example.com" });
	await configuration.load();
	value = { ...value, tls: { ...value.tls, acme: { email: "disk@example.com" } } };
	await configuration.reload();
	expect(configuration.getTlsConfig()?.acme.email).toBe("override@example.com");
	value = { ...value, metadata: { clusterId: "other" } };
	await configuration.reload();
	expect(configuration.getClusterId()).toBe("prod");
});

test.each([
	{ ingress: { baseDomain: "other.example.com" } },
	{ ingress: { baseDomain: "apps.example.com", httpPort: 8080 } },
	{ ingress: { baseDomain: "apps.example.com", httpsPort: 8443 } },
	{ auth: undefined, tls: undefined },
])("rejects startup topology changes while preserving every previous setting: %j", async (change) => {
	let content = JSON.stringify(authenticatedConfig);
	const configuration = new PaasConfig(async () => content);
	await configuration.load();
	const before = configuration.getEditableConfig();
	content = JSON.stringify({
		...authenticatedConfig,
		...change,
		git: { pollIntervalSeconds: 99, operationTimeoutSeconds: 99 },
	});
	const capture = captureLogs();
	try {
		await configuration.reload();
	} finally {
		capture.restore();
	}
	expect(configuration.getEditableConfig()).toEqual(before);
	expect(capture.lines.join("")).toContain("restart");
});

test("all getters reject access before initialization and protect nested configuration from mutation", async () => {
	const configuration = new PaasConfig(async () => JSON.stringify(authenticatedConfig));
	expect(() => configuration.getEditableConfig()).toThrow("has not been loaded");
	const snapshot = await configuration.load();
	snapshot.metadata.clusterId = "changed";
	configuration.getAuthConfig()!.github.allowedUsers.push("mallory");
	configuration.getTlsConfig()!.dns.credentials.apiToken = "changed";
	configuration.getGitConfig().operationTimeoutSeconds = 999;
	configuration.getReconciliationConfig().retryBackoffSeconds = 999;
	configuration.getIngressConfig().baseDomain = "changed";
	expect(configuration.getEditableConfig().config).toEqual(configuration.sanitize(parseConfig(authenticatedConfig)));
});

test("rejects platform YAML warnings without exposing source", async () => {
	await expect(
		new PaasConfig(async () => `!private-secret ${JSON.stringify(authenticatedConfig)}`).load(),
	).rejects.toEqual(
		new Error(
			"Cannot load platform configuration; check /etc/homelab-paas/config.yaml against the platform configuration contract",
		),
	);
});

test("rejects descriptor YAML warnings without exposing source", () => {
	expect(() => decodeDescriptorYaml(`!private-secret ${JSON.stringify(descriptor)}`, "test-service")).toThrow(
		new Error("Invalid service descriptor: check service identity and resource configuration"),
	);
});

test("environment credentials override YAML before validation without mutating the environment", async () => {
	const environment = Object.freeze({ GITHUB_CLIENT_ID: "local-id", GITHUB_CLIENT_SECRET: "local-secret" });
	const configuration = new PaasConfig(
		async () =>
			JSON.stringify({
				...authenticatedConfig,
				auth: {
					...authenticatedConfig.auth,
					github: { ...authenticatedConfig.auth.github, clientId: "", clientSecret: "" },
				},
			}),
		environment,
	);
	expect((await configuration.load()).auth?.github).toMatchObject({
		clientId: "local-id",
		clientSecret: "local-secret",
	});
	expect(environment).toEqual({ GITHUB_CLIENT_ID: "local-id", GITHUB_CLIENT_SECRET: "local-secret" });
});

test("absent environment credentials retain YAML values and empty overrides fail safely", async () => {
	const read = async () => JSON.stringify(authenticatedConfig);
	expect((await new PaasConfig(read, {}).load()).auth?.github).toMatchObject({
		clientId: "id",
		clientSecret: "secret",
	});
	for (const environment of [{ GITHUB_CLIENT_ID: "" }, { GITHUB_CLIENT_SECRET: "" }]) {
		await expect(new PaasConfig(read, environment).load()).rejects.toThrow("Cannot load platform configuration");
	}
});

test("environment credentials alone do not enable authentication", async () => {
	const { auth: _auth, tls: _tls, ...publicConfig } = authenticatedConfig;
	expect(
		(
			await new PaasConfig(async () => JSON.stringify(publicConfig), {
				GITHUB_CLIENT_ID: "id",
				GITHUB_CLIENT_SECRET: "secret",
			}).load()
		).auth,
	).toBeUndefined();
});

test("session and TLS environment values override YAML before validation", async () => {
	const value = {
		...authenticatedConfig,
		auth: { ...authenticatedConfig.auth, session: { ...authenticatedConfig.auth.session, signingKey: "" } },
		tls: { acme: { email: "" }, dns: { provider: "digitalocean", credentials: { apiToken: "" } } },
	};
	const loaded = await new PaasConfig(async () => JSON.stringify(value), {
		SESSION_SIGNING_KEY: "s".repeat(32),
		DIGITALOCEAN_API_TOKEN: "local-token",
		ACME_EMAIL: "local@example.test",
	}).load();
	expect(loaded.auth?.session.signingKey).toBe("s".repeat(32));
	expect(loaded.tls).toEqual({
		acme: { email: "local@example.test" },
		dns: { provider: "digitalocean", credentials: { apiToken: "local-token" } },
	});
});

test.each(["SESSION_SIGNING_KEY", "DIGITALOCEAN_API_TOKEN", "ACME_EMAIL"])(
	"rejects an empty %s override without exposing it",
	async (key) => {
		await expect(
			new PaasConfig(async () => JSON.stringify(authenticatedConfig), { [key]: "" }).load(),
		).rejects.toThrow("Cannot load platform configuration");
	},
);

test("accepts paired auth/TLS configuration and validates secrets without a configured callback", () => {
	const value = authenticatedConfig;
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
