import { expect, test } from "vitest";

import { testConfig } from "../util/test/config.ts";
import { EnvoyService } from "./envoy-service.ts";
import { EnvoyClientError, type EnvoyConfiguration } from "./types.ts";

test.each([undefined, 443])(
	"management pause/resume can outlast graceful container shutdown (TLS %s)",
	async (httpsPort) => {
		let configuration: EnvoyConfiguration | undefined;
		await new EnvoyService(
			{
				bootstrap: async () => {},
				apply: async (value) => {
					configuration = value;
				},
			},
			testConfig({ ingress: { baseDomain: "example.test", httpPort: 80, httpsPort } }),
		).configureRoutes({});
		const text = JSON.stringify(configuration?.listeners);
		expect(text).toContain(
			JSON.stringify({
				match: {
					safe_regex: { google_re2: {}, regex: "/api/ui/services/[^/]+/(pause|resume)" },
					headers: [{ name: ":method", string_match: { exact: "POST" } }],
				},
				route: { cluster: "paas", timeout: "0s", idle_timeout: "0s" },
			}),
		);
	},
);

test.each([undefined, 443])(
	"strips supplied identity before authorization on every listener, TLS %s",
	async (httpsPort) => {
		let configuration: EnvoyConfiguration | undefined;
		await new EnvoyService(
			{
				bootstrap: async () => {},
				apply: async (value) => {
					configuration = value;
				},
			},
			testConfig({ ingress: { baseDomain: "example.test", httpPort: 80, httpsPort } }),
		).configureRoutes({});
		const listeners: {
			filter_chains: {
				filters: { typed_config: { http_filters: { name: string; typed_config: unknown }[] } }[];
			}[];
		}[] = JSON.parse(JSON.stringify(configuration!.listeners));
		for (const listener of listeners)
			for (const chain of listener.filter_chains)
				for (const filter of chain.filters) {
					const filters = filter.typed_config.http_filters;
					expect(filters.at(0)).toMatchObject({
						name: "envoy.filters.http.header_mutation",
						typed_config: {
							mutations: {
								request_mutations: [
									{ remove: "x-webauth-user" },
									{ remove: "x-webauth-email" },
									{ remove: "x-webauth-fullname" },
								],
							},
						},
					});
					const auth = filters.find((entry) => entry.name === "envoy.filters.http.ext_authz");
					if (auth)
						expect(auth.typed_config).toMatchObject({
							http_service: {
								authorization_response: {
									allowed_upstream_headers: {
										patterns: expect.arrayContaining([
											{ exact: "x-webauth-user" },
											{ exact: "x-webauth-email" },
											{ exact: "x-webauth-fullname" },
										]),
									},
								},
							},
						});
				}
	},
);

test.each([undefined, 443])(
	"all ingress listeners emit structured access logs without queries or credentials (HTTPS %s)",
	async (httpsPort) => {
		let configuration: EnvoyConfiguration | undefined;
		await new EnvoyService(
			{
				bootstrap: async () => {},
				apply: async (value) => {
					configuration = value;
				},
			},
			testConfig({ ingress: { baseDomain: "example.test", httpPort: 80, httpsPort } }),
		).configureRoutes({});
		const listeners: { filter_chains: { filters: { typed_config: { access_log?: unknown[] } }[] }[] }[] =
			JSON.parse(JSON.stringify(configuration!.listeners));
		for (const listener of listeners)
			for (const chain of listener.filter_chains)
				for (const filter of chain.filters) {
					const logs = JSON.stringify(filter.typed_config.access_log);
					expect(logs).toContain("envoy.access_loggers.stdout");
					expect(logs).toContain("%REQ_WITHOUT_QUERY(:PATH)%");
					expect(logs).toContain("%UPSTREAM_CLUSTER%");
					expect(logs).toContain("%RESPONSE_CODE_DETAILS%");
					expect(logs).not.toMatch(/cookie|authorization|location|REQ\(:PATH\)|X-ENVOY-ORIGINAL-PATH/i);
				}
	},
);

test.each([undefined, 443])(
	"static routes use the isolated serving listener and shared primary host, TLS %s",
	async (httpsPort) => {
		let configuration: EnvoyConfiguration | undefined;
		await new EnvoyService(
			{
				bootstrap: async () => {},
				apply: async (value) => {
					configuration = value;
				},
			},
			testConfig({ ingress: { baseDomain: "example.test", httpPort: 80, httpsPort } }),
		).configureRoutes({
			"site.demo": {
				address: "127.0.0.1",
				port: 8081,
				static: true,
				public: httpsPort === undefined,
				primary: true,
			},
			"app.demo": { address: "10.0.0.2", port: 80, public: true, primary: false },
		});
		const cluster = configuration?.clusters.find((cluster) => cluster.name === "service-site.demo");
		expect(cluster).toMatchObject({
			type: "STRICT_DNS",
			load_assignment: {
				endpoints: [
					{
						lb_endpoints: [
							{ endpoint: { address: { socket_address: { address: "paas", port_value: 8081 } } } },
						],
					},
				],
			},
		});
		const text = JSON.stringify(configuration?.listeners);
		expect(text).toContain(
			'"domains":["site.demo.example.test","site.demo.example.test:*","demo.example.test","demo.example.test:*"]',
		);
		// Static hosts have one ordinary route, with the listener's normal authorization filter.
		expect(text).toContain('"routes":[{"match":{"prefix":"/"},"route":{"cluster":"service-site.demo"}}]');
		if (httpsPort) expect(text).toContain('"failure_mode_allow":false');
	},
);

test.each([undefined, 443])(
	"workload WebSockets retain ingress authorization while other management routes reject upgrades (HTTPS %s)",
	async (httpsPort) => {
		let configuration: EnvoyConfiguration | undefined;
		await new EnvoyService(
			{
				bootstrap: async () => {},
				apply: async (value) => {
					configuration = value;
				},
			},
			testConfig({ ingress: { baseDomain: "example.test", httpPort: 80, httpsPort } }),
		).configureRoutes({
			"app.demo": {
				address: "10.0.0.2",
				port: 8080,
				healthcheckPath: "/health",
				public: httpsPort === undefined,
				primary: true,
			},
		});
		const text = JSON.stringify(configuration?.listeners);
		expect(text.match(/"upgrade_type":"websocket","enabled":true/g)).toHaveLength(2);
		expect(text).toContain(
			JSON.stringify({
				name: "app.demo",
				domains: [
					"app.demo.example.test",
					"app.demo.example.test:*",
					"demo.example.test",
					"demo.example.test:*",
				],
				routes: [
					{
						match: {
							prefix: "/",
							headers: [{ name: "upgrade", string_match: { exact: "websocket", ignore_case: true } }],
						},
						route: {
							cluster: "service-app.demo",
							timeout: "0s",
							idle_timeout: "300s",
							upgrade_configs: [{ upgrade_type: "websocket", enabled: true }],
						},
					},
					{ match: { prefix: "/" }, route: { cluster: "service-app.demo" } },
				],
			}),
		);
		expect(text).toContain(
			'"match":{"path":"/api/ui/live"},"route":{"cluster":"paas","timeout":"0s","idle_timeout":"0s","upgrade_configs":[{"upgrade_type":"websocket","enabled":true}]}',
		);
		expect(text).toContain('"upgrade_type":"websocket","enabled":false');
		if (httpsPort) {
			expect(text).toContain('"name":"envoy.filters.http.ext_authz"');
			expect(text).toContain('"failure_mode_allow":false');
			expect(text).toContain('"allowed_upstream_headers":{"patterns":[{"exact":"cookie"},{"exact":"location"},');
		}
	},
);

test.each([undefined, 443])(
	"routes independent resource hosts with one primary alias, HTTPS port %s",
	async (httpsPort) => {
		let configuration: EnvoyConfiguration | undefined;
		const service = new EnvoyService(
			{
				async bootstrap() {},
				async apply(value) {
					configuration = value;
				},
			},
			testConfig({ ingress: { baseDomain: "example.test", httpPort: 80, httpsPort } }),
		);
		await service.configureRoutes({
			"app.demo": { address: "10.0.0.1", port: 80, healthcheckPath: "/ready", public: true, primary: true },
			"admin.demo": { address: "10.0.0.2", port: 8080, healthcheckPath: "/health", public: true, primary: false },
		});
		const text = JSON.stringify(configuration?.listeners);
		expect(text).toContain(
			'"domains":["app.demo.example.test","app.demo.example.test:*","demo.example.test","demo.example.test:*"]',
		);
		expect(text).toContain('"domains":["admin.demo.example.test","admin.demo.example.test:*"]');
		expect(configuration?.clusters.map(({ name }) => name)).toEqual([
			"paas",
			"service-admin.demo",
			"service-app.demo",
		]);
	},
);

test.each([undefined, null])("omits Envoy health checks without an explicit path: %s", async (healthcheckPath) => {
	let configuration: EnvoyConfiguration | undefined;
	const service = new EnvoyService(
		{
			bootstrap: async () => {},
			apply: async (value) => {
				configuration = value;
			},
		},
		testConfig({ ingress: { baseDomain: "example.test", httpPort: 80 } }),
	);
	await service.configureRoutes({ demo: { address: "10.0.0.2", port: 8080, healthcheckPath, public: true } });
	expect(configuration?.clusters.find(({ name }) => name === "service-demo")).not.toHaveProperty("health_checks");
});

test("bootstrap delegates discovery initialization to the client", async () => {
	let initialized = false;
	const service = new EnvoyService(
		{
			async bootstrap() {
				initialized = true;
			},
			async apply() {},
		},
		testConfig({ ingress: { baseDomain: "example.test", httpPort: 80 } }),
	);
	await service.bootstrap();
	expect(initialized).toBe(true);
});

test("formats service destinations, health checks, stable hostnames, and withdrawal", async () => {
	const configurations: EnvoyConfiguration[] = [];
	const service = new EnvoyService(
		{
			async bootstrap() {},
			async apply(config) {
				configurations.push(config);
			},
		},
		testConfig({
			ingress: {
				baseDomain: "example.test",
				httpPort: 80,
			},
		}),
	);
	await service.configureRoutes({
		demo: { address: "10.0.0.2", port: 3000, healthcheckPath: "/ready", public: true },
	});
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
	{ address: "not-an-ip", port: 80, healthcheckPath: "/ready", public: true },
	{ address: "10.0.0.2", port: 0, healthcheckPath: "/ready", public: true },
	{ address: "10.0.0.2", port: 80, healthcheckPath: "ready", public: true },
])("rejects unusable destinations before publication", async (endpoint) => {
	let calls = 0;
	const service = new EnvoyService(
		{
			async bootstrap() {},
			async apply() {
				calls++;
			},
		},
		testConfig({ ingress: { baseDomain: "example.test", httpPort: 80 } }),
	);
	await expect(service.configureRoutes({ demo: endpoint })).rejects.toThrow(EnvoyClientError);
	expect(calls).toBe(0);
});

test("secures external traffic with SDS, fail-closed authorization and isolated login routes", async () => {
	const configurations: EnvoyConfiguration[] = [];
	const service = new EnvoyService(
		{
			async bootstrap() {},
			async apply(config) {
				configurations.push(config);
			},
		},
		testConfig({ ingress: { baseDomain: "apps.example.com", httpPort: 80, httpsPort: 443 } }),
	);
	await service.configureRoutes({
		demo: { address: "10.0.0.2", port: 3000, healthcheckPath: "/health", public: false },
	});
	const listeners = configurations.at(0)!.listeners;
	expect(listeners.map(({ name }) => name)).toEqual(["http", "https"]);
	const text = JSON.stringify(listeners);
	expect(text).toContain("https_redirect");
	expect(text).toContain("auth.apps.example.com");
	expect(text).toContain("/auth/callback");
	expect(text).toContain("/var/homelab-paas/_paas/envoy/sds.yaml");
	expect(text).toContain('"failure_mode_allow":false');
	expect(text).toContain('"path_prefix":"/auth/check"');
	expect(text).toContain('"allowed_upstream_headers":{"patterns":[{"exact":"cookie"},{"exact":"location"},');
	expect(text).toContain('"name":"management","domains":["apps.example.com","apps.example.com:*"]');
	expect(text).toContain('"match":{"prefix":"/"},"route":{"cluster":"paas"}');
	expect(text).toContain('"match":{"prefix":"/auth/"},"direct_response":{"status":404}');
});
