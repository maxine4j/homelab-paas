import { isIP } from "node:net";

import type { Endpoint } from "../reconciler/networking/types.ts";
import type { IEnvoyClient } from "./envoy-client.ts";
import { EnvoyClientError } from "./types.ts";

export interface IEnvoyService {
	/** Replace service routes and confirm activation. Rejects with EnvoyClientError. */
	configureRoutes(endpoints: Record<string, Endpoint>): Promise<void>;
}

/** Generates external routing, authorization and filesystem SDS configuration. */
export class EnvoyService implements IEnvoyService {
	constructor(
		private readonly client: IEnvoyClient,
		private readonly ingress: { baseDomain: string; httpPort: number; httpsPort?: number },
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
		if (this.ingress.httpsPort) {
			await this.client.apply({ clusters, listeners: this.secureListeners(entries.map(([id]) => id)) });
			return;
		}
		if (entries.some(([, endpoint]) => endpoint.public === false)) throw new EnvoyClientError();
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

	private secureListeners(serviceIds: string[]) {
		const disabled = {
			"envoy.filters.http.ext_authz": {
				"@type": "type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthzPerRoute",
				disabled: true,
			},
		};
		const authHost = {
			name: "auth",
			domains: [`auth.${this.ingress.baseDomain}`, `auth.${this.ingress.baseDomain}:*`],
			routes: ["/oauth/github/login", "/oauth/github/callback"].map((path) => ({
				match: { path },
				route: { cluster: "paas" },
				typed_per_filter_config: disabled,
			})),
		};
		const httpFilters = [
			{
				name: "envoy.filters.http.ext_authz",
				typed_config: {
					"@type": "type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthz",
					failure_mode_allow: false,
					allowed_headers: { patterns: [{ exact: "cookie" }] },
					http_service: {
						server_uri: { uri: "http://paas:8080", cluster: "paas", timeout: "2s" },
						path_prefix: "/auth/check",
						authorization_response: {
							// Envoy 1.37 also selects denied-response headers from this list.
							allowed_upstream_headers: { patterns: [{ exact: "cookie" }, { exact: "location" }] },
							allowed_client_headers: { patterns: [{ exact: "location" }] },
						},
					},
				},
			},
			{
				name: "envoy.filters.http.router",
				typed_config: { "@type": "type.googleapis.com/envoy.extensions.filters.http.router.v3.Router" },
			},
		];
		const manager = (name: string, virtualHosts: unknown[], filters: unknown[]) => ({
			name: "envoy.filters.network.http_connection_manager",
			typed_config: {
				"@type":
					"type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager",
				stat_prefix: name,
				route_config: { name, virtual_hosts: virtualHosts },
				http_filters: filters,
			},
		});
		return [
			{
				"@type": "type.googleapis.com/envoy.config.listener.v3.Listener",
				name: "http",
				address: socket("0.0.0.0", this.ingress.httpPort),
				filter_chains: [
					{
						filters: [
							manager(
								"redirect",
								[
									{
										name: "redirect",
										domains: ["*"],
										routes: [
											{
												match: { prefix: "/" },
												redirect: {
													https_redirect: true,
													port_redirect: this.ingress.httpsPort,
												},
											},
										],
									},
								],
								httpFilters.slice(1),
							),
						],
					},
				],
			},
			{
				"@type": "type.googleapis.com/envoy.config.listener.v3.Listener",
				name: "https",
				address: socket("0.0.0.0", this.ingress.httpsPort!),
				filter_chains: [
					{
						transport_socket: {
							name: "envoy.transport_sockets.tls",
							typed_config: {
								"@type":
									"type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext",
								common_tls_context: {
									tls_certificate_sds_secret_configs: [
										{
											name: "ingress",
											sds_config: {
												path_config_source: { path: "/var/homelab-paas/_paas/sds.yaml" },
											},
										},
									],
								},
							},
						},
						filters: [
							manager(
								"https",
								[
									authHost,
									...serviceIds.map((id) =>
										virtualHost(id, `${id}.${this.ingress.baseDomain}`, `service-${id}`),
									),
								],
								httpFilters,
							),
						],
					},
				],
			},
		];
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
