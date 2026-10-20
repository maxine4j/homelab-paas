import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

import Koa from "koa";

import { bootstrap } from "./bootstrap.ts";
import { Configuration, decodeDescriptorYaml } from "./configuration/configuration.ts";
import { DockerClient } from "./docker/docker-client.ts";
import { DockerService } from "./docker/docker-service.ts";
import { NodeDockerTransport } from "./docker/docker-transport.ts";
import { EnvoyClient } from "./envoy/envoy-client.ts";
import { EnvoyService } from "./envoy/envoy-service.ts";
import { NodeEnvoyTransport } from "./envoy/envoy-transport.ts";
import { GitClient } from "./git/git-client.ts";
import { GitService } from "./git/git-service.ts";
import { NodeGitTransport } from "./git/git-transport.ts";
import { DeploymentService } from "./reconciler/deployment/deployment-service.ts";
import { RecreateDeploymentStrategy } from "./reconciler/deployment/strategy/recreate-deployment-strategy.ts";
import { FileReconciliationStore } from "./reconciler/file-reconciliation-store.ts";
import { NetworkingService } from "./reconciler/networking/networking-service.ts";
import { ReconcilerService } from "./reconciler/reconciler-service.ts";
import { ReconcilerTask } from "./reconciler/reconciler-task.ts";
import { WebResourceReconciler } from "./reconciler/resources/web/web-reconciler.ts";
import { PeriodicTaskRunner } from "./task/periodic.ts";
import { createHealthCheckRouter, probe } from "./util/healthcheck.ts";
import type { Lifecycle } from "./util/lifecycle.ts";
import { logger } from "./util/logger.ts";
import { sleep } from "./util/sleep.ts";

export async function start(lifecycle: Lifecycle): Promise<void> {
	const config = await new Configuration((path) => readFile(path, "utf8")).load();
	const stateDirectory = "/var/homelab-paas/_paas";
	await bootstrap(stateDirectory);
	const store = new FileReconciliationStore(stateDirectory);
	const docker = new DockerService(
		new DockerClient(
			new NodeDockerTransport({
				socketPath: "/var/run/docker.sock",
				timeoutMs: 120_000,
				maxResponseBytes: 16 * 1024 * 1024,
			}),
		),
		config.metadata.clusterId,
	);
	const envoy = new EnvoyService(
		new EnvoyClient(
			new NodeEnvoyTransport({
				directory: stateDirectory,
				adminUrl: "http://envoy:9901",
				timeoutMs: 2000,
				maxResponseBytes: 16 * 1024 * 1024,
			}),
			sleep,
			{ attempts: 30, intervalMs: 1000 },
		),
		config.ingress,
	);
	const networking = new NetworkingService(store, envoy);
	const deployment = new DeploymentService([new RecreateDeploymentStrategy(docker, networking, probe, sleep)]);
	const reconciler = new ReconcilerService(
		config.services,
		config.reconciliation,
		new GitService(
			new GitClient(new NodeGitTransport(config.git.operationTimeoutSeconds * 1000, process.env)),
			`${stateDirectory}/git`,
		),
		decodeDescriptorYaml,
		new WebResourceReconciler(docker, deployment, networking, probe),
		store,
		Date.now,
		(serviceId, message) => logger.error({ serviceId }, message),
	);
	const abort = new AbortController();
	const runner = new PeriodicTaskRunner({
		lifecycle,
		periodMs: config.git.pollIntervalSeconds * 1000,
		task: new ReconcilerTask(reconciler),
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
		() =>
			new Promise<void>((resolve, reject) =>
				server.close((error: unknown) => (error ? reject(error) : resolve())),
			),
	);
	await once(server, "listening");
	await envoy.configureRoutes(await store.getAll());
	if (!lifecycle.isOpen()) return;
	const running = runner.start();
	lifecycle.registerShutdownHandler(async () => {
		abort.abort();
		await running;
	});
}
