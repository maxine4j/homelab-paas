import { expect, test } from "vitest";

import { Configuration, decodeDescriptorYaml, parseConfig, parseDescriptor } from "./config.ts";

const descriptor = {
	version: 1,
	metadata: { serviceId: "test-service" },
	resources: { app: { type: "web", image: "test-service:local", ingress: { public: true, port: 8080 } } },
};

test("validates the complete MVP descriptor and applies documented defaults", () => {
	expect(parseDescriptor(descriptor, "test-service").resources["app"]).toMatchObject({
		replicas: 1,
		rolloutStrategy: "recreate",
		healthcheckUrl: "/healthcheck",
	});
});

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

test("rejects mismatched identities, advanced resources, private ingress and unsupported options", () => {
	for (const value of [
		{ ...descriptor, metadata: { serviceId: "other" } },
		{ ...descriptor, resources: { db: { type: "postgres", image: "postgres:17" } } },
		{ ...descriptor, resources: { app: { ...descriptor.resources.app, replicas: 2 } } },
		{ ...descriptor, resources: { app: { ...descriptor.resources.app, ingress: { port: 8080 } } } },
		{ ...descriptor, resources: { app: { ...descriptor.resources.app, volumes: [] } } },
		{ ...descriptor, resources: { app: descriptor.resources.app, other: descriptor.resources.app } },
	])
		expect(() => parseDescriptor(value, "test-service")).toThrow("Invalid service descriptor");
});

test("configuration defaults remote branches, requires absolute local paths and excludes auth/TLS", () => {
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
