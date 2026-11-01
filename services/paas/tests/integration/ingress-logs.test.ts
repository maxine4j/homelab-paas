import { once } from "node:events";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { uiLiveServerSchema } from "@homelab-paas/shared-contracts";
import { expect, test, vi } from "vitest";
import { WebSocket } from "ws";

import { decodeDescriptorYaml } from "../../src/config/paas-config.ts";
import { DockerClient } from "../../src/docker/docker-client.ts";
import { DockerLogClient } from "../../src/docker/docker-log-client.ts";
import { DockerLogService } from "../../src/docker/docker-log-service.ts";
import { DockerService } from "../../src/docker/docker-service.ts";
import { NodeDockerTransport } from "../../src/docker/docker-transport.ts";
import { ChangeBus } from "../../src/events/change-bus.ts";
import { PaasUiService } from "../../src/frontend/paas-ui-service.ts";
import { UiLiveService } from "../../src/frontend/ui-live-service.ts";
import { UiWebSocket } from "../../src/frontend/ui-websocket.ts";
import { ResourceRoutingPolicy } from "../../src/reconciler/networking/resource-routing-policy.ts";
import { ResourceSpecification } from "../../src/reconciler/resource-specification.ts";
import { ResourceStatusService } from "../../src/status/resource-status-service.ts";
import { mkdtemp, rm } from "../../src/util/file.ts";
import { sleep } from "../../src/util/sleep.ts";
import { testConfig } from "../../src/util/test/config.ts";
import { MockHttpServer } from "../util/http-server.ts";

test("ingress subscription discovers owned Envoy and streams bounded redacted Docker output over WebSocket", async () => {
	const directory = await mkdtemp(join(tmpdir(), "ingress-logs-"));
	const socketPath = join(directory, "docker.sock");
	const labels = { "homelab-paas.cluster": "local", "homelab-paas.role": "envoy" };
	let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
	let canceled = false;
	const dockerApi = await new MockHttpServer((request) => {
		if (request.url.pathname === "/v1.48/containers/json") {
			expect(JSON.parse(request.url.searchParams.get("filters")!)).toEqual({
				label: Object.entries(labels).map(([key, value]) => `${key}=${value}`),
			});
			return Response.json([
				{ Id: "envoy", ImageID: "image", Names: ["/envoy"], State: "running", Labels: labels },
			]);
		}
		if (request.url.pathname === "/v1.48/containers/envoy/json")
			return Response.json({
				Id: "envoy",
				Image: "image",
				State: { Running: true },
				HostConfig: { NanoCpus: 0, Memory: 0 },
				Config: { Labels: labels, Env: ["PASSWORD=envoy-canary"] },
				NetworkSettings: { Networks: {} },
			});
		if (request.url.pathname === "/v1.48/containers/envoy/logs") {
			expect(Object.fromEntries(request.url.searchParams)).toEqual({
				stdout: "true",
				stderr: "true",
				timestamps: "true",
				tail: "200",
				follow: "true",
			});
			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						stream = controller;
					},
					cancel() {
						canceled = true;
					},
				}),
			);
		}
		return undefined;
	}).listen(socketPath);
	const config = testConfig();
	const transport = new NodeDockerTransport({ socketPath, timeoutMs: 2000, maxResponseBytes: 1048576 }, sleep);
	const docker = new DockerService(new DockerClient(transport), config);
	const logs = new DockerLogService(docker, new DockerLogClient(transport), config);
	const ui = new PaasUiService(
		new ResourceRoutingPolicy(),
		new ResourceStatusService(new ResourceSpecification(), { resolve: async () => [] }),
		config,
		{ fetchFile: vi.fn(), readCommit: vi.fn() },
		decodeDescriptorYaml,
		docker,
		{ read: vi.fn(), write: vi.fn() },
		{ list: vi.fn(), append: vi.fn() },
		{ getStatus: () => "Unknown", refineStatus: (health) => health },
		logs,
	);
	const adapter = new UiWebSocket(
		new UiLiveService(ui, ui, new ChangeBus()),
		() => "http://management.test",
		undefined,
		sleep,
	);
	const server = createServer();
	adapter.attach(server);
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing listener");
	const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/ui/live`, {
		headers: { origin: "http://management.test" },
	});
	const snapshots: string[] = [];
	socket.on("message", (message) => {
		const parsed = uiLiveServerSchema.parse(JSON.parse(String(message)));
		if (parsed.type === "snapshot") snapshots.push(JSON.stringify(parsed));
	});
	const frame = (text: string): Buffer => {
		const body = Buffer.from(text);
		const header = Buffer.alloc(8);
		header[0] = 1;
		header.writeUInt32BE(body.length, 4);
		return Buffer.concat([header, body]);
	};
	try {
		await once(socket, "open");
		socket.send(JSON.stringify({ type: "subscribe", id: "ingress", target: { kind: "ingress-logs" } }));
		await expect.poll(() => stream !== undefined).toBe(true);
		stream!.enqueue(frame("envoy-can"));
		stream!.enqueue(frame("ary\nAuthorization: Bearer cred"));
		stream!.enqueue(frame("ential\nready\n"));
		await expect.poll(() => snapshots.join("")).toContain("ready");
		expect(snapshots.join("")).toContain("envoy-canary");
		expect(snapshots.join("")).not.toContain("credential");
		expect(snapshots.join("")).toContain("Authorization: [redacted]");
		stream!.enqueue(frame(Array.from({ length: 210 }, (_, index) => `line-${index}\n`).join("")));
		await expect.poll(() => snapshots.at(-1)).toContain("line-209");
		const latest = JSON.parse(snapshots.at(-1)!);
		expect(latest).toMatchObject({ target: { kind: "ingress-logs" }, data: { containerId: "envoy", tail: 200 } });
		expect(latest.data.content.split("\n").filter(Boolean)).toHaveLength(200);
		socket.send(JSON.stringify({ type: "unsubscribe", id: "ingress" }));
		await expect.poll(() => canceled).toBe(true);
	} finally {
		socket.terminate();
		await adapter.close();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await dockerApi.close();
		await rm(directory, { recursive: true, force: true });
	}
});
