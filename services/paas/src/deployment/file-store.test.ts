import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";
import yaml from "yaml";

import { FileDeploymentStore } from "./file-store.ts";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
test("publishes filesystem xDS with service hostnames, private upstreams and active health checks", async () => {
	const root = await mkdtemp(join(tmpdir(), "paas-routes-"));
	roots.push(root);
	const ingress = { baseDomain: "localhost", httpPort: 80 };
	const store = new FileDeploymentStore(root, ingress);
	await store.initialize();
	await store.set("demo", { address: "10.0.0.2", port: 8080, healthcheckPath: "/health" });
	const listeners: unknown = yaml.parse(await readFile(join(root, "lds.yaml"), "utf8"));
	expect(listeners).toMatchObject({
		resources: [
			{
				address: { socket_address: { port_value: 80 } },
				filter_chains: [
					{
						filters: [
							{
								typed_config: {
									route_config: {
										virtual_hosts: expect.arrayContaining([
											{
												name: "demo",
												domains: ["demo.localhost", "demo.localhost:*"],
												routes: [
													{ match: { prefix: "/" }, route: { cluster: "service-demo" } },
												],
											},
										]),
									},
								},
							},
						],
					},
				],
			},
		],
	});
	const clusters: unknown = yaml.parse(await readFile(join(root, "cds.yaml"), "utf8"));
	expect(clusters).toMatchObject({
		resources: expect.arrayContaining([
			expect.objectContaining({
				name: "service-demo",
				common_lb_config: { healthy_panic_threshold: { value: 0 } },
				health_checks: [expect.objectContaining({ http_health_check: { path: "/health" } })],
				load_assignment: {
					cluster_name: "service-demo",
					endpoints: [
						{
							lb_endpoints: [
								{
									endpoint: {
										address: { socket_address: { address: "10.0.0.2", port_value: 8080 } },
									},
								},
							],
						},
					],
				},
			}),
		]),
	});
	// Restore other services' last routes before the first post-restart Git poll.
	const restored = new FileDeploymentStore(root, ingress);
	await restored.initialize();
	await restored.set("other", { address: "10.1.0.2", port: 9000 });
	expect(await readFile(join(root, "lds.yaml"), "utf8")).toContain("demo.localhost");
	await restored.set("demo", undefined);
	expect(await readFile(join(root, "lds.yaml"), "utf8")).not.toContain("demo.localhost");
	await restored.write("demo", { desiredRevision: "commit1", phase: "failed", error: "Readiness failed" });
	expect(yaml.parse(await readFile(join(root, "demo.state.yaml"), "utf8"))).toEqual({
		desiredRevision: "commit1",
		phase: "failed",
		error: "Readiness failed",
	});
	expect(yaml.parse(await readFile(join(root, "routes.yaml"), "utf8"))).toEqual({
		other: { address: "10.1.0.2", port: 9000 },
	});
});
