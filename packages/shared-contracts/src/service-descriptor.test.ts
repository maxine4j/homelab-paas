import { expect, test } from "vitest";

import { parseDescriptor } from "./service-descriptor.ts";

const descriptor = {
	version: 1,
	metadata: { serviceId: "test-service" },
	resources: { app: { type: "web", image: "test-service:local", ingress: { public: true, port: 8080 } } },
};

test("descriptor schema failures retain field-level validation details as a cause", () => {
	expect(() => parseDescriptor({ version: "invalid" }, "demo")).toThrow(
		expect.objectContaining({ cause: expect.any(Error) }),
	);
});

test("validates a web descriptor and applies documented defaults", () => {
	expect(parseDescriptor(descriptor, "test-service").resources["app"]).toMatchObject({
		replicas: 1,
		rolloutStrategy: "recreate",
		healthcheckUrl: "/healthcheck",
	});
});

test("multiple web resources require exactly one explicit primary", () => {
	const app = descriptor.resources.app;
	const resources = { app: { ...app, primary: true }, admin: { ...app, primary: false } };
	expect(parseDescriptor({ ...descriptor, resources }, "test-service").resources).toMatchObject(resources);
	for (const primary of [undefined, false, true]) {
		expect(() =>
			parseDescriptor(
				{ ...descriptor, resources: { app: { ...app, primary }, admin: { ...app, primary } } },
				"test-service",
			),
		).toThrow("Invalid service descriptor");
	}
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
		volumes: [{ hostPath: "/srv/app/uploads", mountPath: "/app/uploads", readOnly: false }],
		egress: ["another-service"],
		termination: { timeoutSeconds: 60 },
		limits: { cpus: 0.5, memoryMiB: 256 },
	};
	const resources = {
		app: { ...workload, type: "web", ingress: { public: false, port: 3000 } },
		worker: { ...workload, type: "worker", healthcheckPort: 8081 },
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
				worker: { type: "worker", image: "worker:1", healthcheckPort: 8081 },
			},
		},
		"test-service",
	);
	expect(parsed.resources["app"]).toMatchObject({ ingress: { public: false } });
	expect(parsed.resources["worker"]).toEqual({
		type: "worker",
		image: "worker:1",
		healthcheckPort: 8081,
		healthcheckUrl: "/healthcheck",
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

test("workers accept a private health check with a custom path", () => {
	const worker = { type: "worker", image: "app:1", healthcheckPort: 9000, healthcheckUrl: "/ready" };
	expect(parseDescriptor({ ...descriptor, resources: { worker } }, "test-service").resources["worker"]).toMatchObject(
		worker,
	);
});

test.each([
	{},
	{ healthcheckPort: 0 },
	{ healthcheckPort: 65536 },
	{ healthcheckPort: 1.5 },
	{ healthcheckPort: 8081, healthcheckUrl: "http://example.com/health" },
	{ healthcheckPort: 8081, healthcheckUrl: "//example.com/health" },
	{ healthcheckPort: 8081, ingress: { port: 8081 } },
])("rejects invalid worker health checks: %j", (healthcheck) => {
	expect(() =>
		parseDescriptor(
			{ ...descriptor, resources: { worker: { type: "worker", image: "app:1", ...healthcheck } } },
			"test-service",
		),
	).toThrow("Invalid service descriptor");
});

test.each(["/srv/media", "/mnt/other disk/data", "/etc/application.conf"])(
	"accepts arbitrary absolute Docker host paths: %s",
	(hostPath) => {
		expect(
			parseDescriptor(
				{
					...descriptor,
					resources: { app: { ...descriptor.resources.app, volumes: [{ hostPath, mountPath: "/data" }] } },
				},
				"test-service",
			).resources["app"],
		).toMatchObject({ volumes: [{ hostPath, mountPath: "/data" }] });
	},
);

test.each([
	{ volumes: [{ hostPath: "relative", mountPath: "/data" }] },
	{ volumes: [{ hostPath: "/data", mountPath: "relative" }] },
	{ volumes: [{ hostPath: "/bad\0path", mountPath: "/data" }] },
	{ volumes: [{ hostPath: "/data", mountPath: "/bad\0path" }] },
	{ volumes: [{ hostPath: "/srv/data:ro", mountPath: "/data" }] },
	{ volumes: [{ hostPath: "/data", mountPath: "/data:ro" }] },
	{ volumes: [{ hostPath: "/data", mountPath: "/" }] },
	{
		volumes: [
			{ hostPath: "/a", mountPath: "/data" },
			{ hostPath: "/b", mountPath: "/data" },
		],
	},
	{
		env: [
			{ name: "TOKEN", value: "one" },
			{ name: "TOKEN", secret: true },
		],
	},
	{ env: [{ name: "TOKEN", value: "bad\0value" }] },
	{ limits: { cpus: 0.0000000001 } },
	{ limits: { memoryMiB: Number.MAX_SAFE_INTEGER } },
])("rejects ambiguous or unrepresentable workload settings: %j", (fields) => {
	expect(() =>
		parseDescriptor(
			{ ...descriptor, resources: { app: { ...descriptor.resources.app, ...fields } } },
			"test-service",
		),
	).toThrow("Invalid service descriptor");
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
	{ type: "worker", image: "app:1", healthcheckUrl: "//health" },
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
	expect(() =>
		parseDescriptor(
			{
				...descriptor,
				resources: {
					app: {
						...(resource.type === "worker" ? { healthcheckPort: 8081 } : {}),
						...resource,
					},
				},
			},
			"test-service",
		),
	).toThrow("Invalid service descriptor: check service identity and resource configuration");
});
