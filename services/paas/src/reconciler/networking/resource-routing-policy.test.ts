import type { ServiceDescriptor } from "@homelab-paas/shared-contracts";
import { expect, test } from "vitest";

import { ResourceRoutingPolicy } from "./resource-routing-policy.ts";
import type { Endpoint } from "./types.ts";

const policy = new ResourceRoutingPolicy();
const web = { type: "web" as const, image: "app:1", ingress: { port: 8080 } };
const site = { type: "static" as const, path: "dist" };

test.each<[ServiceDescriptor["resources"], string | undefined]>([
	[{}, undefined],
	[{ worker: { type: "worker", image: "worker:1", healthcheckPort: 8080 } }, undefined],
	[{ app: { ...web, primary: false } }, "app"],
	[{ site: { ...site, primary: false } }, "site"],
	[{ app: web, site: { ...site, primary: true } }, "site"],
	[{ site, app: { ...web, primary: true } }, "app"],
	[{ site: { ...site, primary: true }, app: web }, "site"],
	[{ app: { ...web, primary: true }, site }, "app"],
])("selects the sole or explicit primary from raw validated resources: %j", (resources, expected) => {
	expect(policy.primaryResource(resources)).toBe(expected);
});

test("projects explicit effective policies with private ingress and the control-plane static listener", () => {
	expect(policy.webEndpoint({ ...web, primary: false, healthcheckUrl: null }, "10.0.0.2")).toEqual({
		address: "10.0.0.2",
		port: 8080,
		public: false,
		primary: false,
		healthcheckPath: undefined,
	});
	expect(policy.staticEndpoint({ ...site, primary: true })).toEqual({
		address: "127.0.0.1",
		port: 8081,
		static: true,
		public: false,
		primary: true,
	});
	expect(
		policy.webEndpoint(
			{ ...web, ingress: { port: 80, public: true }, primary: true, healthcheckUrl: "/ready" },
			"10.0.0.3",
		),
	).toEqual({
		address: "10.0.0.3",
		port: 80,
		public: true,
		primary: true,
		healthcheckPath: "/ready",
	});
});

test("semantic equality normalizes absent primary, static and null healthcheck without depending on object order", () => {
	const expected: Endpoint = { address: "10.0.0.2", port: 80, public: false, primary: true, static: false };
	expect(policy.matches(expected, { public: false, port: 80, address: "10.0.0.2", healthcheckPath: null })).toBe(
		true,
	);
	expect(policy.matches(expected, undefined)).toBe(false);
	for (const change of [
		{ address: "10.0.0.3" },
		{ port: 8080 },
		{ public: true },
		{ primary: false },
		{ static: true },
		{ healthcheckPath: "/ready" },
	])
		expect(policy.matches(expected, { ...expected, ...change })).toBe(false);
});
