import { once } from "node:events";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";
import { WebSocket } from "ws";

import { decodeDescriptorYaml } from "../../src/config/paas-config.ts";
import { ChangeBus } from "../../src/events/change-bus.ts";
import { PaasUiService } from "../../src/frontend/paas-ui-service.ts";
import { UiLiveService } from "../../src/frontend/ui-live-service.ts";
import { UiWebSocket } from "../../src/frontend/ui-websocket.ts";
import { GitClient } from "../../src/git/git-client.ts";
import { GitService } from "../../src/git/git-service.ts";
import { NodeGitTransport } from "../../src/git/git-transport.ts";
import { mkdtemp, rm } from "../../src/util/file.ts";
import { sleep } from "../../src/util/sleep.ts";
import { testConfig } from "../../src/util/test/config.ts";
import { TestGit } from "../util/git.ts";

test("cold live subscription serves persisted Git objects while background remote fetch is slow/offline", async () => {
	const directory = await mkdtemp(join(tmpdir(), "live-disk-git-"));
	let release: () => void = () => {};
	const remote = new Promise<void>((resolve) => {
		release = resolve;
	});
	let fetching = false;
	let settle: () => Promise<unknown> = async () => {};
	class OfflineClient extends GitClient {
		override async fetch(): Promise<void> {
			fetching = true;
			await remote;
			throw new Error("Remote is offline");
		}
	}
	const server = createServer();
	let socket: WebSocket | undefined;
	let adapter: UiWebSocket | undefined;
	try {
		const repository = new TestGit(directory);
		await repository.init();
		const revision = await repository.commit({
			"demo.sd.yaml": JSON.stringify({
				version: 1,
				metadata: { serviceId: "demo" },
				resources: { app: { type: "web", image: "app:1", ingress: { port: 80, public: true } } },
			}),
		});
		const source = { remote: repository.remote, descriptorPath: "demo.sd.yaml" };
		const config = testConfig({ services: { demo: source } });
		const transport = new NodeGitTransport(config);
		const cacheDirectory = join(directory, "cache");
		await new GitService(new GitClient(transport), cacheDirectory).refreshFile("demo", source);
		const cold = new GitService(new OfflineClient(transport), cacheDirectory);
		settle = () => cold.refreshFile("demo", source).catch(() => {});
		const ui = new PaasUiService(
			config,
			cold,
			decodeDescriptorYaml,
			{
				listServiceContainers: async () => [],
				inspectServiceContainer: async () => null,
				readServiceContainerLogs: async () => "",
			},
			{
				read: async () => ({ phase: "ready", activeRevision: revision, desiredRevision: revision }),
				write: async () => {},
			},
			{ append: async () => {}, list: async () => [] },
		);
		adapter = new UiWebSocket(
			new UiLiveService(ui, ui, new ChangeBus()),
			() => "http://management.test",
			undefined,
			sleep,
		);
		adapter.attach(server);
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing listener");
		socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/ui/live`, {
			headers: { origin: "http://management.test" },
		});
		await once(socket, "open");
		const message = once(socket, "message");
		socket.send(JSON.stringify({ type: "subscribe", id: "disk", target: { kind: "services" } }));
		const result = await Promise.race([
			message,
			sleep(1500).then(() => {
				throw new Error("Live snapshot blocked behind remote Git");
			}),
		]);
		expect(JSON.parse(String(result[0]))).toMatchObject({
			type: "snapshot",
			data: [
				{
					serviceId: "demo",
					phase: "ready",
					activeRevision: revision,
					activeRevisionMetadata: { authorName: "CI" },
				},
			],
		});
		await expect.poll(() => fetching).toBe(true);
	} finally {
		release();
		await settle();
		socket?.terminate();
		await adapter?.close();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(directory, { recursive: true, force: true });
	}
});
