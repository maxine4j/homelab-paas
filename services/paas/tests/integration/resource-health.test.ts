import { once } from "node:events";
import { createServer } from "node:http";

import { uiLiveServerSchema } from "@homelab-paas/shared-contracts";
import { expect, test } from "vitest";
import { WebSocket } from "ws";

import { decodeDescriptorYaml } from "../../src/config/paas-config.ts";
import type { ServiceContainer } from "../../src/docker/types.ts";
import { ChangeBus } from "../../src/events/change-bus.ts";
import { PaasUiService } from "../../src/frontend/paas-ui-service.ts";
import { UiLiveService } from "../../src/frontend/ui-live-service.ts";
import { UiWebSocket } from "../../src/frontend/ui-websocket.ts";
import { ResourceHealthService } from "../../src/health/resource-health-service.ts";
import { probe } from "../../src/util/healthcheck.ts";
import { sleep } from "../../src/util/sleep.ts";
import { testConfig } from "../../src/util/test/config.ts";
import { MockHttpServer } from "../util/http-server.ts";

test("HTTP health polling pushes resource health over WebSocket while retaining container state and service phase", async () => {
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
	const containers: ServiceContainer[] = [
		{ id: "c", resourceId: "app", imageId: "image", revision: "rev", state: "running", spec: "s" },
	];
	const docker = {
		listServiceContainers: async () => containers,
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
		config,
		git,
		decodeDescriptorYaml,
		docker,
		{ read: async () => ({ phase: "ready", activeRevision: "rev" }), write: async () => {} },
		{ list: async () => [], append: async () => {} },
		health,
	);
	const adapter = new UiWebSocket(
		new UiLiveService(ui, ui, changes),
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
		const next = async () => uiLiveServerSchema.parse(JSON.parse(String((await once(socket!, "message"))[0])));
		let snapshot = next();
		socket.send(
			JSON.stringify({
				type: "subscribe",
				id: "health",
				target: { kind: "resource", serviceId: "demo", resourceId: "app" },
			}),
		);
		expect(await snapshot).toMatchObject({
			type: "snapshot",
			data: { health: "unhealthy", containers: [{ state: "running" }] },
		});
		for (const [isReady, expected] of [
			[true, "healthy"],
			[false, "unhealthy"],
			[true, "healthy"],
		] as const) {
			ready = isReady;
			snapshot = next();
			await health.run();
			expect(await snapshot).toMatchObject({
				type: "snapshot",
				data: { health: expected, containers: [{ state: "running" }] },
			});
		}
		snapshot = next();
		health.started("demo", "app");
		expect(await snapshot).toMatchObject({ data: { health: "deploying" } });
		snapshot = next();
		health.finished("demo", "app");
		expect(await snapshot).toMatchObject({ data: { health: "unhealthy" } });
		containers.length = 0;
		snapshot = next();
		await health.run();
		expect(await snapshot).toMatchObject({ data: { health: "missing", containers: [] } });
		expect((await ui.getService("demo")).phase).toBe("ready");
		expect(endpoint.requests.map(({ url }) => url.pathname)).toEqual(["/ready", "/ready", "/ready"]);
	} finally {
		socket?.terminate();
		await adapter.close();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await endpoint.close();
	}
});
