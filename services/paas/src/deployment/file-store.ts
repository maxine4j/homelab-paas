import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import yaml from "yaml";
import { z } from "zod";

import {
	DeploymentError,
	type DeploymentStatus,
	type Endpoint,
	type RouteStore,
	type StateStore,
} from "./contracts.ts";

const savedRoutes = z.record(
	z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
	z.strictObject({
		address: z.union([z.ipv4(), z.ipv6()]),
		port: z.number().int().min(1).max(65535),
		healthcheckPath: z.string().startsWith("/").optional(),
	}),
);
const socket = (address: string, port: number) => ({ socket_address: { address, port_value: port } });
const assignment = (name: string, address: string, port: number) => ({
	cluster_name: name,
	endpoints: [{ lb_endpoints: [{ endpoint: { address: socket(address, port) } }] }],
});
const virtualHost = (name: string, domain: string, cluster: string) => ({
	name,
	domains: [domain, `${domain}:*`],
	routes: [{ match: { prefix: "/" }, route: { cluster } }],
});

export class FileDeploymentStore implements RouteStore, StateStore {
	private routes: Record<string, Endpoint> = {};
	constructor(
		private readonly directory: string,
		private readonly ingress: { baseDomain: string; httpPort: number },
	) {}
	async initialize(): Promise<void> {
		try {
			await mkdir(this.directory, { recursive: true, mode: 0o700 });
			let content: string | undefined;
			try {
				content = await readFile(join(this.directory, "routes.yaml"), "utf8");
			} catch (error) {
				if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
			}
			if (content) this.routes = savedRoutes.parse(yaml.parse(content));
			await this.publish();
		} catch {
			throw new DeploymentError("Cannot initialize persisted Envoy routes");
		}
	}
	private async atomic(name: string, content: string): Promise<void> {
		const target = join(this.directory, name);
		await writeFile(`${target}.tmp`, content, { mode: 0o600 });
		await rename(`${target}.tmp`, target);
	}
	async set(serviceId: string, endpoint: Endpoint | undefined): Promise<void> {
		const previous = this.routes;
		const next = { ...previous };
		if (endpoint) next[serviceId] = endpoint;
		else delete next[serviceId];
		if (JSON.stringify(previous) === JSON.stringify(next)) return;
		this.routes = next;
		try {
			await this.publish();
		} catch {
			this.routes = previous;
			throw new DeploymentError("Cannot publish Envoy routes");
		}
	}
	async write(serviceId: string, state: DeploymentStatus): Promise<void> {
		try {
			await this.atomic(`${serviceId}.state.yaml`, yaml.stringify(state));
		} catch {
			throw new DeploymentError("Cannot persist deployment state");
		}
	}
	private async publish(): Promise<void> {
		const entries = Object.entries(this.routes).sort(([a], [b]) => a.localeCompare(b));
		const version_info = createHash("sha256")
			.update(JSON.stringify([this.ingress, entries]))
			.digest("hex");
		const clusters = [
			{
				"@type": "type.googleapis.com/envoy.config.cluster.v3.Cluster",
				name: "paas",
				type: "STRICT_DNS",
				connect_timeout: "2s",
				load_assignment: assignment("paas", "paas", 8080),
			},
			...entries.map(([serviceId, endpoint]) => ({
				"@type": "type.googleapis.com/envoy.config.cluster.v3.Cluster",
				name: `service-${serviceId}`,
				type: "STATIC",
				connect_timeout: "2s",
				common_lb_config: { healthy_panic_threshold: { value: 0 } },
				load_assignment: assignment(`service-${serviceId}`, endpoint.address, endpoint.port),
				health_checks: [
					{
						timeout: "2s",
						interval: "5s",
						unhealthy_threshold: 1,
						healthy_threshold: 1,
						http_health_check: { path: endpoint.healthcheckPath ?? "/healthcheck" },
					},
				],
			})),
		];
		const listener = {
			"@type": "type.googleapis.com/envoy.config.listener.v3.Listener",
			name: "http",
			address: socket("0.0.0.0", this.ingress.httpPort),
			filter_chains: [
				{
					filters: [
						{
							name: "envoy.filters.network.http_connection_manager",
							typed_config: {
								"@type":
									"type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager",
								stat_prefix: "http",
								route_config: {
									name: "services",
									virtual_hosts: [
										virtualHost("paas", this.ingress.baseDomain, "paas"),
										...entries.map(([serviceId]) =>
											virtualHost(
												serviceId,
												`${serviceId}.${this.ingress.baseDomain}`,
												`service-${serviceId}`,
											),
										),
									],
								},
								http_filters: [
									{
										name: "envoy.filters.http.router",
										typed_config: {
											"@type":
												"type.googleapis.com/envoy.extensions.filters.http.router.v3.Router",
										},
									},
								],
							},
						},
					],
				},
			],
		};
		// Atomic replacement is required for Envoy's filesystem watches.
		await this.atomic("cds.yaml", yaml.stringify({ version_info, resources: clusters }));
		await this.atomic("lds.yaml", yaml.stringify({ version_info, resources: [listener] }));
		await this.atomic("routes.yaml", yaml.stringify(this.routes));
	}
}
