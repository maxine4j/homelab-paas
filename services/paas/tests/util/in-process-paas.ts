import type { IPaasConfig } from "../../src/config/paas-config.ts";
import { decodeDescriptorYaml } from "../../src/config/paas-config.ts";
import { DockerClient } from "../../src/docker/docker-client.ts";
import { DockerService } from "../../src/docker/docker-service.ts";
import { NodeDockerTransport } from "../../src/docker/docker-transport.ts";
import { EnvoyClient } from "../../src/envoy/envoy-client.ts";
import { EnvoyService } from "../../src/envoy/envoy-service.ts";
import { NodeEnvoyTransport } from "../../src/envoy/envoy-transport.ts";
import { GitClient } from "../../src/git/git-client.ts";
import { GitService } from "../../src/git/git-service.ts";
import { NodeGitTransport } from "../../src/git/git-transport.ts";
import { DeploymentService } from "../../src/reconciler/deployment/deployment-service.ts";
import { RecreateDeploymentStrategy } from "../../src/reconciler/deployment/strategy/recreate-deployment-strategy.ts";
import { SurgeDeploymentStrategy } from "../../src/reconciler/deployment/strategy/surge-deployment-strategy.ts";
import { WorkerDeploymentService } from "../../src/reconciler/deployment/worker-deployment-service.ts";
import { EnvironmentResolver } from "../../src/reconciler/environment-resolver.ts";
import { EndpointsStore } from "../../src/reconciler/networking/endpoints-store.ts";
import { NetworkingService } from "../../src/reconciler/networking/networking-service.ts";
import { ReconcilerService } from "../../src/reconciler/reconciler-service.ts";
import { ReconciliationStore } from "../../src/reconciler/reconciliation-store.ts";
import { WebResourceReconciler } from "../../src/reconciler/resources/web/web-reconciler.ts";
import { WorkerResourceReconciler } from "../../src/reconciler/resources/worker/worker-reconciler.ts";
import { FileSystemKeyValueStore } from "../../src/store/file-system-store.ts";
import { atomicWriteFile, mkdir, readFile, rm } from "../../src/util/file.ts";
import { probe } from "../../src/util/healthcheck.ts";
import { sleep, type ISleep } from "../../src/util/sleep.ts";

/** Real service/client/store composition with socket/HTTP boundaries and an explicit clock. */
export const inProcessPaas = async (
	config: IPaasConfig,
	directory: string,
	dockerSocket: string,
	adminUrl: string,
	now: () => number,
	pause: ISleep,
) => {
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const state = new FileSystemKeyValueStore<unknown>(
		directory,
		readFile,
		atomicWriteFile,
		(path) => rm(path, { force: true }),
		"yaml",
	);
	const checkpoints = new ReconciliationStore(state);
	const endpoints = new EndpointsStore(state);
	const docker = new DockerService(
		new DockerClient(
			new NodeDockerTransport(
				{ socketPath: dockerSocket, timeoutMs: 2000, maxResponseBytes: 1024 * 1024 },
				sleep,
			),
		),
		config,
	);
	const envoy = new EnvoyService(
		new EnvoyClient(
			new NodeEnvoyTransport({ directory, adminUrl, timeoutMs: 2000, maxResponseBytes: 1024 * 1024 }),
			pause,
			{ attempts: 2, intervalMs: 1 },
		),
		config,
	);
	await envoy.bootstrap();
	const networking = new NetworkingService(endpoints, envoy);
	const deployments = new DeploymentService([
		new RecreateDeploymentStrategy(docker, networking, probe, pause),
		new SurgeDeploymentStrategy(docker, networking, probe, pause, () => "integration"),
	]);
	const reconciler = new ReconcilerService(
		config,
		new GitService(new GitClient(new NodeGitTransport(config)), `${directory}/git`),
		decodeDescriptorYaml,
		new WebResourceReconciler(docker, deployments, networking, probe),
		checkpoints,
		now,
		new EnvironmentResolver(`${directory}/env`, readFile),
		new WorkerResourceReconciler(
			docker,
			new WorkerDeploymentService(docker, probe, pause, () => "integration"),
			probe,
		),
	);
	return { reconciler, checkpoints, endpoints };
};
