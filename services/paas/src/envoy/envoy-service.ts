import { isIP } from "node:net";

import type { Endpoint } from "../reconciler/networking/types.ts";
import type { IEnvoyClient } from "./envoy-client.ts";
import { EnvoyClientError } from "./types.ts";

export interface IEnvoyService {
	/** Replace service routes and confirm activation. Rejects with EnvoyClientError. */
	configureRoutes(endpoints: Record<string, Endpoint>): Promise<void>;
}

/** Public HTTP routing for the standalone reconciler; auth/TLS remain deferred. */
export class EnvoyService implements IEnvoyService {
	constructor(
		private readonly client: IEnvoyClient,
		private readonly ingress: { baseDomain: string; httpPort: number },
	) {}

	async configureRoutes(endpoints: Record<string, Endpoint>): Promise<void> {
		const entries = Object.entries(endpoints).sort(([a], [b]) => a.localeCompare(b));
		for (const [, endpoint] of entries) {
			if (
				!isIP(endpoint.address)
				|| !Number.isInteger(endpoint.port)
				|| endpoint.port < 1
				|| endpoint.port > 65535
				|| !endpoint.healthcheckPath.startsWith("/")
			)
				throw new EnvoyClientError();
		}
		const clusters = [
			{
				"@type": "type.googleapis.com/envoy.config.cluster.v3.Cluster",
				name: "paas",
				type: "STRICT_DNS",
				connect_timeout: "2s",
				load_assignment: assignment("paas", "paas", 8080),
			},
			...entries.map(([id, endpoint]) => ({
				"@type": "type.googleapis.com/envoy.config.cluster.v3.Cluster",
				name: `service-${id}`,
				type: "STATIC",
				connect_timeout: "2s",
				common_lb_config: { healthy_panic_threshold: { value: 0 } },
				load_assignment: assignment(`service-${id}`, endpoint.address, endpoint.port),
				health_checks: [
					{
						timeout: "2s",
						interval: "5s",
						unhealthy_threshold: 1,
						healthy_threshold: 1,
						http_health_check: { path: endpoint.healthcheckPath },
					},
				],
			})),
		];
		await this.client.apply({
			clusters,
			listeners: [
				{
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
												...entries.map(([id]) =>
													virtualHost(
														id,
														`${id}.${this.ingress.baseDomain}`,
														`service-${id}`,
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
				},
			],
		});
	}
}

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
