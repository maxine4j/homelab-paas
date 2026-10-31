import type { UiCluster, UiResource, UiService, UiServiceEvent } from "@homelab-paas/shared-contracts";
import type { Plugin } from "vite";

const revision = "b7e92a43c0d851fa6e129b0d2c7a8e5409631fba";
const resources: UiResource[] = [
	{
		resourceId: "web",
		sync: "Synced",
		health: "Healthy",
		type: "web",
		url: "https://web.paperless.example.test",
		primaryUrl: "https://paperless.example.test",
		configYaml: `type: web
image: ghcr.io/paperless-ngx/paperless-ngx:2.20
replicas: 1
rolloutStrategy: recreate
ingress:
  port: 8000
  public: false
primary: true
healthcheckUrl: /health
env:
  - name: PAPERLESS_TIME_ZONE
    value: "[redacted]"
  - name: PAPERLESS_SECRET_KEY
    secret: "[redacted]"
volumes:
  - hostPath: /srv/paperless/data
    mountPath: /usr/src/paperless/data
    readOnly: false
  - hostPath: /srv/paperless/consume
    mountPath: /usr/src/paperless/consume
    readOnly: false
limits:
  cpus: 2
  memoryMiB: 2048
egress:
  - database
  - broker
`,
		config: {
			type: "web",
			image: "ghcr.io/paperless-ngx/paperless-ngx:2.20",
			replicas: 1,
			rolloutStrategy: "recreate",
			ingress: { port: 8000, public: false },
			primary: true,
			healthcheckUrl: "/health",
			env: [
				{ name: "PAPERLESS_TIME_ZONE", value: "[redacted]" },
				{ name: "PAPERLESS_SECRET_KEY", secret: "[redacted]" },
			],
			volumes: [
				{ hostPath: "/srv/paperless/data", mountPath: "/usr/src/paperless/data", readOnly: false },
				{ hostPath: "/srv/paperless/consume", mountPath: "/usr/src/paperless/consume", readOnly: false },
			],
			limits: { cpus: 2, memoryMiB: 2048 },
			egress: ["database", "broker"],
		},
		containers: [
			{
				id: "8a34c91e7f02b5d6801234567890abcdef1234567890abcdef1234567890abcd",
				resourceId: "web",
				imageId: "sha256:9ad73e5b81034fc8e65db649c2a40bb2d19a6de79f0b36c6d13e39f907e4a2e1",
				state: "running",
				running: true,
				revision,
				networks: { "paperless-internal": { address: "172.22.0.4", aliases: ["web", "paperless-web"] } },
			},
		],
	},
	{
		resourceId: "database",
		sync: "Synced",
		health: "Healthy",
		type: "postgres",
		configYaml: "type: postgres\nimage: postgres:17\nlimits:\n  cpus: 1\n  memoryMiB: 1024\n",
		config: { type: "postgres", image: "postgres:17", limits: { cpus: 1, memoryMiB: 1024 } },
		containers: [
			{
				id: "6d2c9a103e45",
				resourceId: "database",
				imageId: "sha256:7bf192dd24",
				state: "running",
				running: true,
				revision,
				networks: { "paperless-internal": { address: "172.22.0.2", aliases: ["database"] } },
			},
		],
	},
	{
		resourceId: "broker",
		sync: "Synced",
		health: "Healthy",
		type: "rabbitmq",
		configYaml: "type: rabbitmq\nimage: rabbitmq:4\nlimits:\n  memoryMiB: 512\n",
		config: { type: "rabbitmq", image: "rabbitmq:4", limits: { memoryMiB: 512 } },
		containers: [
			{
				id: "fb5719ac2043",
				resourceId: "broker",
				imageId: "sha256:58e932a77c",
				state: "running",
				running: true,
				revision,
				networks: { "paperless-internal": { address: "172.22.0.3", aliases: ["broker"] } },
			},
		],
	},
];
const service: UiService = {
	serviceId: "paperless",
	description: "Document management for the homelab, with searchable archives and automatic document processing",
	primaryUrl: "https://paperless.example.test",
	activeRevisionMetadata: {
		message: "Improve document ingestion and resource configuration\n\nKeep searchable archives up to date.",
		authorName: "Alex",
		authoredAt: "2026-10-28T01:00:00Z",
	},
	sync: "Synced",
	health: "Healthy",
	activeRevision: revision,
	desiredRevision: revision,
	descriptorRevision: revision,
	descriptorStatus: "available",
	source: {
		remote: "https://github.com/example/homelab.git",
		branch: "main",
		descriptorPath: "paperless/service.sd.yaml",
	},
	descriptor: {
		version: 1,
		metadata: { serviceId: "paperless", description: "Document management" },
		resources: Object.fromEntries(resources.map((resource) => [resource.resourceId, resource.config!])),
	},
	descriptorYaml: `version: 1
metadata:
  serviceId: paperless
  description: Document management
resources:
${resources
	.map(
		(resource) =>
			`  ${resource.resourceId}:\n${resource
				.configYaml!.trimEnd()
				.split("\n")
				.map((line) => `    ${line}`)
				.join("\n")}`,
	)
	.join("\n")}
`,
	resources,
};
const events: UiServiceEvent[] = [
	{
		timestamp: Date.now() - 120000,
		level: "info",
		event: "deployment.succeeded",
		message: "Service is ready. All resources match the desired configuration.",
		revision,
	},
	{
		timestamp: Date.now() - 180000,
		level: "info",
		event: "reconciliation.recovered",
		message: "Service reconciliation recovered.",
		resourceId: "web",
		revision,
	},
	{
		timestamp: Date.now() - 240000,
		level: "error",
		event: "reconciliation.failed",
		message: "Docker POST /containers/create: HTTP 500: bind source path does not exist",
		resourceId: "web",
		revision,
		failures: 1,
		retryAt: Date.now() - 180000,
		diagnostics: JSON.stringify({
			error: {
				name: "DockerServiceError",
				message: "Docker POST /containers/create: HTTP 500: bind source path does not exist",
				stack: "DockerServiceError: Docker POST /containers/create: HTTP 500: bind source path does not exist\n    at DockerService.createContainer (file:///app/services/paas/src/docker/docker-service.ts:241:10)\n    at WebReconciler.reconcile (file:///app/services/paas/src/reconciler/web-reconciler.ts:89:4)",
				cause: {
					name: "DockerClientError",
					message: "bind source path does not exist: /srv/paperless/consume",
					stack: "DockerClientError: bind source path does not exist: /srv/paperless/consume\n    at DockerClient.request (file:///app/services/paas/src/docker/docker-client.ts:162:10)",
					method: "POST",
					path: "/containers/create",
					status: 500,
					body: { message: "bind source path does not exist: /srv/paperless/consume" },
				},
			},
			contextYaml: `operation: web
serviceId: paperless
resourceId: web
resource:
  type: web
  image: ghcr.io/paperless-ngx/paperless-ngx:2.20
  env: "[redacted]"
  volumes:
    - hostPath: /srv/paperless/consume
      mountPath: /usr/src/paperless/consume
`,
		}),
	},
	{
		timestamp: Date.now() - 300000,
		level: "info",
		event: "deployment.succeeded",
		message: "Service is ready.",
		resourceId: "web",
		revision: "92a81cf",
	},
];
const cluster: UiCluster = {
	clusterId: "homelab-preview",
	config: { ingress: { baseDomain: "example.test" } },
	revision: "mock-1",
	fields: [],
};

/** Opt-in Vite middleware; never included in the production application. */
export const mockApi = (): Plugin => ({
	name: "paas-mock-api",
	configureServer(server) {
		server.middlewares.use("/api/ui", (request, response) => {
			response.setHeader("Content-Type", "application/json");
			response.setHeader("Cache-Control", "no-store");
			if (request.method !== "GET" && request.method !== "HEAD") {
				response.statusCode = 405;
				response.end(JSON.stringify({ error: "Mock preview is read-only" }));
				return;
			}
			const path = request.url?.split("?").at(0);
			let data: unknown;
			if (path === "/cluster") data = cluster;
			if (path === "/cluster/logs")
				data = {
					containerId: "preview-control-plane",
					tail: 200,
					content:
						"2026-10-31T00:00:00Z Control plane ready; background reconciliation enabled\n2026-10-31T00:00:05Z Reconciliation completed\n",
				};
			if (path === "/services") data = [service, { serviceId: "jellyfin", sync: "Unknown", health: "Unknown" }];
			if (path === "/services/paperless") data = service;
			if (path === "/services/jellyfin")
				data = {
					serviceId: "jellyfin",
					sync: "Unknown",
					health: "Unknown",
					source: {},
					descriptorStatus: "unavailable",
					resources: [],
				};
			if (path === "/services/paperless/events") data = events;
			if (path === "/services/jellyfin/events") data = [];
			if (path === "/services/paperless/secrets")
				data = {
					revision: "mock",
					variables: [
						{ name: "PAPERLESS_SECRET_KEY", configured: true, used: true },
						{ name: "PAPERLESS_EMAIL_PASSWORD", configured: false, used: true },
						{ name: "FUTURE_API_TOKEN", configured: true, used: false },
					],
				};
			if (path === "/services/jellyfin/secrets") data = { revision: "mock", variables: [] };
			for (const resource of resources) {
				if (path === `/services/paperless/resources/${resource.resourceId}`) data = resource;
				for (const container of resource.containers)
					if (path === `/services/paperless/resources/${resource.resourceId}/containers/${container.id}/logs`)
						data = {
							containerId: container.id,
							tail: 200,
							content:
								"2026-10-26T00:40:00Z Application started\n2026-10-26T00:40:01Z Connected to database\n2026-10-26T00:40:02Z Listening on port 8000\n2026-10-26T00:40:07Z GET /health 200\n",
						};
			}
			response.statusCode = data === undefined ? 404 : 200;
			response.end(JSON.stringify(data ?? { error: "Mock item not found" }));
		});
	},
});
