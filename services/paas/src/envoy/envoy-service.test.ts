import { expect, test } from "vitest";

import { EnvoyService } from "./envoy-service.ts";
import { EnvoyClientError, type EnvoyConfiguration } from "./types.ts";

test("formats service destinations, health checks, stable hostnames, and withdrawal", async () => {
	const configurations: EnvoyConfiguration[] = [];
	const service = new EnvoyService(
		{
			async apply(config) {
				configurations.push(config);
			},
		},
		{
			baseDomain: "example.test",
			httpPort: 80,
		},
	);
	await service.configureRoutes({ demo: { address: "10.0.0.2", port: 3000, healthcheckPath: "/ready" } });
	expect(configurations.at(0)?.clusters).toContainEqual(
		expect.objectContaining({
			name: "service-demo",
			type: "STATIC",
			load_assignment: {
				cluster_name: "service-demo",
				endpoints: [
					{
						lb_endpoints: [
							{ endpoint: { address: { socket_address: { address: "10.0.0.2", port_value: 3000 } } } },
						],
					},
				],
			},
			health_checks: [expect.objectContaining({ http_health_check: { path: "/ready" } })],
			common_lb_config: { healthy_panic_threshold: { value: 0 } },
		}),
	);
	expect(JSON.stringify(configurations.at(0)?.listeners)).toContain("demo.example.test");
	await service.configureRoutes({});
	expect(configurations.at(-1)?.clusters.map(({ name }) => name)).toEqual(["paas"]);
	expect(JSON.stringify(configurations.at(-1)?.listeners)).not.toContain("demo.example.test");
});

test.each([
	{ address: "not-an-ip", port: 80, healthcheckPath: "/ready" },
	{ address: "10.0.0.2", port: 0, healthcheckPath: "/ready" },
	{ address: "10.0.0.2", port: 80, healthcheckPath: "ready" },
])("rejects unusable destinations before publication", async (endpoint) => {
	let calls = 0;
	const service = new EnvoyService(
		{
			async apply() {
				calls++;
			},
		},
		{ baseDomain: "example.test", httpPort: 80 },
	);
	await expect(service.configureRoutes({ demo: endpoint })).rejects.toThrow(EnvoyClientError);
	expect(calls).toBe(0);
});
