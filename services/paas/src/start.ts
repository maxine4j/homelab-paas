import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

import Koa from "koa";

import { Configuration, decodeDescriptorYaml } from "./deployment/config.ts";
import { DockerWorkloadClient } from "./deployment/docker-client.ts";
import { NodeEngineTransport, probeHttp } from "./deployment/engine.ts";
import { FileDeploymentStore } from "./deployment/file-store.ts";
import { Reconciler } from "./deployment/reconciler.ts";
import { GitDescriptorSource } from "./git/descriptor-source.ts";
import { PeriodicTaskRunner } from "./task/periodic.ts";
import { createHealthCheckRouter } from "./util/healthcheck.ts";
import type { Lifecycle } from "./util/lifecycle.ts";
import { logger } from "./util/logger.ts";

export async function start(lifecycle: Lifecycle): Promise<void> {
	const config = await new Configuration((path) => readFile(path, "utf8")).load();
	const stateDirectory = "/var/homelab-paas/_paas";
	const store = new FileDeploymentStore(stateDirectory, config.ingress);
	await store.initialize();
	const workloads = new DockerWorkloadClient(
		new NodeEngineTransport("/var/run/docker.sock", 120_000),
		config.metadata.clusterId,
		probeHttp,
		(ms) => setTimeout(ms),
	);
	const reconciler = new Reconciler({
		config,
		source: new GitDescriptorSource(`${stateDirectory}/git`, config.git.operationTimeoutSeconds * 1000),
		workloads,
		routes: store,
		state: store,
		decode: decodeDescriptorYaml,
		now: Date.now,
		report: (serviceId, message) => logger.error({ serviceId }, message),
	});
	const abort = new AbortController();
	const runner = new PeriodicTaskRunner({
		lifecycle,
		periodMs: config.git.pollIntervalSeconds * 1000,
		task: reconciler,
		pause: async (ms) => {
			try {
				await setTimeout(ms, undefined, { signal: abort.signal });
			} catch {
				/* Shutdown interrupts the polling delay. */
			}
		},
		report: () => logger.error("Reconciliation task failed; check persistent state and Docker access"),
	});
	const app = new Koa().use(createHealthCheckRouter().routes());
	const server = app.listen(8080, "0.0.0.0");
	lifecycle.registerShutdownHandler(
		() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
	);
	await once(server, "listening");
	const running = runner.start();
	lifecycle.registerShutdownHandler(async () => {
		abort.abort();
		await running;
	});
}
