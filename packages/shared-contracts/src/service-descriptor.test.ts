import { expect, test } from "vitest";

import { parseDescriptor } from "./service-descriptor.ts";

const descriptor = {
	version: 1,
	metadata: { serviceId: "test-service" },
	resources: { app: { type: "web", image: "test-service:local", ingress: { public: true, port: 8080 } } },
};

test("validates a web descriptor and applies documented defaults", () => {
	expect(parseDescriptor(descriptor, "test-service").resources["app"]).toMatchObject({
		replicas: 1,
		rolloutStrategy: "recreate",
		healthcheckUrl: "/healthcheck",
	});
});

test("accepts every resource type and its documented fields", () => {
	const workload = {
		image: "app:1",
		replicas: 3,
		rolloutStrategy: "surge",
		command: ["node", "worker.js"],
		env: [
			{ name: "FOO", value: "123" },
			{ name: "TOKEN", secret: true },
		],
		volumes: [{ source: "app/uploads", target: "/app/uploads", readOnly: false }],
		egress: ["another-service"],
		termination: { timeoutSeconds: 60 },
		limits: { cpus: 0.5, memoryMiB: 256 },
	};
	const resources = {
		app: { ...workload, type: "web", ingress: { public: false, port: 3000 } },
		worker: { ...workload, type: "worker" },
		store: { type: "postgres", image: "postgres:17", limits: { cpus: 1, memoryMiB: 1024 } },
		queue: { type: "rabbitmq", image: "rabbitmq:4", termination: { timeoutSeconds: 60 } },
	};
	expect(parseDescriptor({ ...descriptor, resources }, "test-service").resources).toMatchObject(resources);
});

test("allows services without web resources and defaults workloads and private ingress", () => {
	const parsed = parseDescriptor(
		{
			...descriptor,
			resources: {
				app: { ...descriptor.resources.app, ingress: { port: 8080 } },
				worker: { type: "worker", image: "worker:1" },
			},
		},
		"test-service",
	);
	expect(parsed.resources["app"]).toMatchObject({ ingress: { public: false } });
	expect(parsed.resources["worker"]).toEqual({
		type: "worker",
		image: "worker:1",
		replicas: 1,
		rolloutStrategy: "recreate",
	});
	expect(
		parseDescriptor(
			{ ...descriptor, resources: { store: { type: "postgres", image: "postgres:17" } } },
			"test-service",
		).resources,
	).toEqual({ store: { type: "postgres", image: "postgres:17" } });
});

test("rejects invalid identities, resource fields and multiple web resources", () => {
	for (const value of [
		{ ...descriptor, metadata: { serviceId: "other" } },
		{ ...descriptor, resources: { app: { ...descriptor.resources.app, replicas: 0 } } },
		{ ...descriptor, resources: { app: { ...descriptor.resources.app, unknown: true } } },
		{ ...descriptor, resources: { app: descriptor.resources.app, other: descriptor.resources.app } },
	])
		expect(() => parseDescriptor(value, "test-service")).toThrow("Invalid service descriptor");
});

test.each([
	{ type: "worker", image: "app:1", ingress: { port: 3000 } },
	{ type: "worker", image: "app:1", healthcheckUrl: "/health" },
	{ type: "postgres", image: "postgres:17", volumes: [] },
	{ type: "rabbitmq", image: "rabbitmq:4", env: [] },
	{ type: "postgres", image: "postgres:17", credentials: {} },
	{ type: "rabbitmq", image: "rabbitmq:4", rolloutStrategy: "surge" },
	{ type: "unknown", image: "app:1" },
	{ type: "worker", image: "" },
	{ type: "worker", image: "app:1", replicas: 1.5 },
	{ type: "worker", image: "app:1", limits: { cpus: 0 } },
	{ type: "worker", image: "app:1", limits: { memoryMiB: -1 } },
	{ type: "worker", image: "app:1", env: [{ name: "TOKEN", value: "secret", secret: true }] },
	{ type: "worker", image: "app:1", env: [{ name: "TOKEN", secret: false }] },
	{ type: "worker", image: "app:1", env: [{ name: "PAAS_RESOURCE_STORE_PASSWORD", value: "secret" }] },
	{ type: "worker", image: "app:1", env: [{ name: "FOO", value: 123 }] },
	{ type: "worker", image: "app:1", egress: ["Bad_ID"] },
	{ type: "worker", image: "app:1", volumes: [{ source: "/absolute", target: "/data" }] },
	{ type: "worker", image: "app:1", volumes: [{ source: "app/../data", target: "/data" }] },
	{ type: "worker", image: "app:1", volumes: [{ source: "app/data", target: "relative" }] },
])("rejects invalid resource configuration without exposing values: %j", (resource) => {
	expect(() => parseDescriptor({ ...descriptor, resources: { app: resource } }, "test-service")).toThrow(
		"Invalid service descriptor: check service identity and resource configuration",
	);
});
