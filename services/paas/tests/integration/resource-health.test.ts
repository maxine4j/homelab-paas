import { once } from "node:events";
import { createServer } from "node:http";

import { uiLiveServerSchema } from "@homelab-paas/shared-contracts";
import { expect, test, vi } from "vitest";
import { WebSocket } from "ws";

import { decodeDescriptorYaml } from "../../src/config/paas-config.ts";
import type { ServiceContainer } from "../../src/docker/types.ts";
import { ChangeBus } from "../../src/events/change-bus.ts";
import { CachedPaasUiService } from "../../src/frontend/cached-paas-ui-service.ts";
import { ManagementStateTask } from "../../src/frontend/management-state-task.ts";
import { PaasUiService } from "../../src/frontend/paas-ui-service.ts";
import { UiLiveService } from "../../src/frontend/ui-live-service.ts";
import { UiWebSocket } from "../../src/frontend/ui-websocket.ts";
import { ResourceHealthService } from "../../src/health/resource-health-service.ts";
import { ResourceSpecification } from "../../src/reconciler/resource-specification.ts";
import { ResourceStatusService } from "../../src/status/resource-status-service.ts";
import { probe } from "../../src/util/healthcheck.ts";
import { sleep } from "../../src/util/sleep.ts";
import { testConfig } from "../../src/util/test/config.ts";
import { MockHttpServer } from "../util/http-server.ts";

test("HTTP health polling pushes resource health over WebSocket with independent sync while retaining container state", async () => {
	let ready = true;
	const endpoint = await new MockHttpServer((request) =>
		request.url.pathname === "/ready" ? new Response("ready", { status: ready ? 200 : 503 }) : undefined,
	).listen();
	const server = createServer();
	const changes = new ChangeBus();
	const config = testConfig({ services: { demo: { remote: "local", descriptorPath: "/demo.yaml" } } });
	const git = {
		fetchFile: async () => ({
			revision: "rev",
			content: JSON.stringify({
				version: 1,
				metadata: { serviceId: "demo" },
				resources: {
					app: {
						type: "web",
						image: "app:1",
						ingress: { public: true, port: Number(new URL(endpoint.url).port) },
						healthcheckUrl: "/ready",
					},
				},
			}),
		}),
		readCommit: async () => ({ message: "Deploy app", authorName: "CI", authoredAt: "2026-10-30T00:00:00Z" }),
	};
	const file = await git.fetchFile();
	const resource = decodeDescriptorYaml(file.content, "demo", file.revision).resources["app"];
	if (resource?.type !== "web") throw new Error("Expected web fixture");
	const spec = new ResourceSpecification().get("app", { ...resource, primary: true, env: [] });
	const containers: ServiceContainer[] = [
		{ id: "c", resourceId: "app", imageId: "image", revision: "rev", state: "running", spec },
	];
	const docker = {
		listServiceContainers: vi.fn(async () => containers),
		inspectServiceContainer: async () => ({
			id: "c",
			imageId: "image",
			running: true,
			labels: {},
			networks: { internal: { address: "127.0.0.1", aliases: [] } },
		}),
		inspectServiceNetwork: async () => ({
			id: "net",
			name: "internal",
			driver: "bridge",
			labels: {},
			containerIds: ["c"],
		}),
		readServiceContainerLogs: async () => "",
	};
	const health = new ResourceHealthService(config, git, decodeDescriptorYaml, docker, probe, changes);
	const ui = new PaasUiService(
		new ResourceStatusService(new ResourceSpecification(), {
			resolve: async (_serviceId, env) =>
				env.map((entry) => ({ name: entry.name, value: "value" in entry ? entry.value : "test-secret" })),
		}),
		config,
		git,
		decodeDescriptorYaml,
		docker,
		{ read: async () => ({ phase: "ready", activeRevision: "rev" }), write: async () => {} },
		{ list: async () => [], append: async () => {} },
		health,
	);
	const cache = new CachedPaasUiService(ui, config, changes);
	const task = new ManagementStateTask(health, cache);
	const adapter = new UiWebSocket(
		new UiLiveService(cache, ui, changes),
		() => "http://management.test",
		undefined,
		sleep,
	);
	adapter.attach(server);
	let socket: WebSocket | undefined;
	try {
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing listener");
		socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/ui/live`, { origin: "http://management.test" });
		await once(socket, "open");
		const received: unknown[] = [];
		socket.on("message", (bytes) => received.push(uiLiveServerSchema.parse(JSON.parse(String(bytes)))));
		const latest = async (expected: Record<string, unknown>) => {
			await vi.waitFor(() => expect(received.at(-1)).toMatchObject(expected));
		};
		const next = async () => uiLiveServerSchema.parse(JSON.parse(String((await once(socket!, "message"))[0])));
		const snapshot = next();
		socket.send(
			JSON.stringify({
				type: "subscribe",
				id: "health",
				target: { kind: "resource", serviceId: "demo", resourceId: "app" },
			}),
		);
		expect(await snapshot).toMatchObject({
			type: "snapshot",
			data: { sync: "Synced", health: "Unknown", containers: [{ state: "running" }] },
		});
		const reads = docker.listServiceContainers.mock.calls.length;
		await cache.getResource("demo", "app");
		await cache.getResource("demo", "app");
		expect(docker.listServiceContainers).toHaveBeenCalledTimes(reads);
		for (const [isReady, expected] of [
			[true, "Healthy"],
			[false, "Degraded"],
			[true, "Healthy"],
		] as const) {
			ready = isReady;
			await task.run();
			await latest({
				type: "snapshot",
				data: { sync: "Synced", health: expected, containers: [{ state: "running" }] },
			});
		}
		health.started("demo", "app");
		expect((await cache.getResource("demo", "app")).health).toBe("Healthy");
		await task.run();
		await latest({ data: { health: "Progressing" } });
		health.finished("demo", "app");
		await task.run();
		await latest({ data: { health: "Healthy" } });
		containers.length = 0;
		await task.run();
		await latest({ data: { health: "Missing", containers: [] } });
		expect(await cache.getService("demo")).toMatchObject({ sync: "OutOfSync", health: "Missing" });
		expect(endpoint.requests.map(({ url }) => url.pathname)).toEqual(["/ready", "/ready", "/ready", "/ready"]);
	} finally {
		socket?.terminate();
		await adapter.close();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await endpoint.close();
	}
});
