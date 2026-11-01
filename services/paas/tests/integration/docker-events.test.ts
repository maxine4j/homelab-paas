import { expect, test } from "vitest";

import { testConfig } from "../../src/util/test/config.ts";
import { MockDocker } from "../mocks/docker.ts";
import { MockEnvoy } from "../mocks/envoy.ts";
import { artifactDirectory, TestGit } from "../util/git.ts";
import { inProcessPaas } from "../util/in-process-paas.ts";
import { waitFor } from "../util/wait.ts";

test("real stream, audit and scheduler repair lifecycle/mutable drift and converge after platform feedback", async () => {
	const directory = await artifactDirectory("events");
	const git = new TestGit(directory);
	await git.init();
	await git.commit({
		"demo.yaml": JSON.stringify({
			version: 1,
			metadata: { serviceId: "demo" },
			resources: { app: { type: "web", image: "fixture:local", ingress: { public: true, port: 8080 } } },
		}),
	});
	const journal: string[] = [];
	const docker = new MockDocker("events", journal);
	const envoy = new MockEnvoy(`${directory}/state`, journal);
	await docker.server.listen(`${directory}/docker.sock`);
	await envoy.server.listen();
	let paas: Awaited<ReturnType<typeof inProcessPaas>> | undefined;
	try {
		let release!: () => void;
		let inventoryStarted = false;
		docker.beforeInventory = () => {
			inventoryStarted = true;
			return new Promise<void>((resolve) => {
				release = resolve;
			});
		};
		const starting = inProcessPaas(
			testConfig(
				{
					metadata: { clusterId: "events" },
					auth: undefined,
					tls: undefined,
					services: { demo: { remote: git.remote, descriptorPath: "demo.yaml", branch: "main" } },
				},
				process.env,
			),
			`${directory}/state`,
			`${directory}/docker.sock`,
			envoy.server.url,
			Date.now,
			async () => {},
			true,
		);
		await waitFor("initial inventory after stream headers", async () => inventoryStarted);
		expect(docker.eventConnections).toBe(1);
		docker.emit("container", "update", "missing", {
			"homelab-paas.cluster": "events",
			"homelab-paas.service": "demo",
		});
		release();
		paas = await starting;
		await paas.scheduler.settle();
		const owned = () =>
			[...docker.containers.values()].filter((entry) => entry.Config.Labels["homelab-paas.service"] === "demo");
		expect(owned()).toHaveLength(1);
		const original = owned()[0]!;
		original.State.Running = false;
		docker.emit("container", "die", original.Id, original.Config.Labels);
		await waitFor(
			"event repairs stopped container",
			async () => owned()[0]?.Id !== original.Id && (await paas!.checkpoints.read("demo"))?.phase === "ready",
		);
		await paas.scheduler.settle();
		const replacement = owned()[0]!;
		replacement.HostConfig.Memory = 123456;
		// Deliberately miss the update event: the safety inventory must still repair it.
		await paas.audit.run();
		await paas.scheduler.settle();
		expect(owned()[0]?.Id).not.toBe(replacement.Id);
		const stable = owned()[0]!.Id;
		await paas.scheduler.settle();
		await paas.audit.run();
		await paas.scheduler.settle();
		expect(owned()[0]?.Id).toBe(stable);
		// Reconnect requires a complete scan while the consumer continues receiving hints.
		inventoryStarted = false;
		docker.beforeInventory = () => {
			inventoryStarted = true;
			return new Promise<void>((resolve) => {
				release = resolve;
			});
		};
		docker.disconnectEvents();
		await waitFor("event stream reconnect", async () => docker.eventConnections >= 2);
		await waitFor("reconnect inventory begins", async () => inventoryStarted);
		const reconnectCurrent = owned()[0]!;
		reconnectCurrent.State.Running = false;
		docker.emit("container", "die", reconnectCurrent.Id, reconnectCurrent.Config.Labels);
		await waitFor("event consumed during reconnect scan", async () => owned()[0]?.Id !== stable);
		release();
		await paas.audit.run();
		await paas.scheduler.settle();
		expect(owned()[0]?.Id).not.toBe(stable);
		expect(journal.filter((entry) => entry === "POST /containers/create")).toHaveLength(4);
	} finally {
		await paas?.stop();
		await docker.server.close();
		await envoy.server.close();
	}
});
