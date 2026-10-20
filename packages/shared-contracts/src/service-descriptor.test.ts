import { expect, test } from "vitest";

import { parseDescriptor } from "./service-descriptor.ts";

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
