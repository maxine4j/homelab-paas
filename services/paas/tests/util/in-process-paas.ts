import { onTestFinished } from "vitest";

import type { IPaasConfig } from "../../src/config/paas-config.ts";
import { decodeDescriptorYaml } from "../../src/config/paas-config.ts";
import { DockerClient } from "../../src/docker/docker-client.ts";
import { DockerEventClient } from "../../src/docker/docker-event-client.ts";
import { DockerEventWatcher } from "../../src/docker/docker-event-watcher.ts";
import { DockerService } from "../../src/docker/docker-service.ts";
import { NodeDockerTransport } from "../../src/docker/docker-transport.ts";
import { EnvoyClient } from "../../src/envoy/envoy-client.ts";
import { EnvoyService } from "../../src/envoy/envoy-service.ts";
import { NodeEnvoyTransport } from "../../src/envoy/envoy-transport.ts";
import { ChangeBus } from "../../src/events/change-bus.ts";
import { CachedPaasUiService } from "../../src/frontend/cached-paas-ui-service.ts";
import { ManagementStateTask } from "../../src/frontend/management-state-task.ts";
import { PaasUiService } from "../../src/frontend/paas-ui-service.ts";
import { GitClient } from "../../src/git/git-client.ts";
import { GitRefreshService } from "../../src/git/git-refresh-service.ts";
import { GitService } from "../../src/git/git-service.ts";
import { NodeGitTransport } from "../../src/git/git-transport.ts";
import { HealthHistoryService } from "../../src/health/health-history-service.ts";
import { HealthHistoryStore } from "../../src/health/health-history-store.ts";
import { ResourceHealthService } from "../../src/health/resource-health-service.ts";
import { RuntimeObservations } from "../../src/observation/runtime-observations.ts";
import { DeploymentContainers } from "../../src/reconciler/deployment/deployment-containers.ts";
import { DeploymentService } from "../../src/reconciler/deployment/deployment-service.ts";
import { RecreateDeploymentStrategy } from "../../src/reconciler/deployment/strategy/recreate-deployment-strategy.ts";
import { SurgeDeploymentStrategy } from "../../src/reconciler/deployment/strategy/surge-deployment-strategy.ts";
import { WorkerDeploymentStrategy } from "../../src/reconciler/deployment/strategy/worker-deployment-strategy.ts";
import { DesiredInputs } from "../../src/reconciler/desired-inputs.ts";
import { DriftAudit } from "../../src/reconciler/drift-audit.ts";
import { EnvironmentResolver } from "../../src/reconciler/environment-resolver.ts";
import { EventDiagnostics } from "../../src/reconciler/event-diagnostics.ts";
import { EndpointsStore } from "../../src/reconciler/networking/endpoints-store.ts";
import { NetworkingService } from "../../src/reconciler/networking/networking-service.ts";
import { ResourceRoutingPolicy } from "../../src/reconciler/networking/resource-routing-policy.ts";
import { ReconcilerService } from "../../src/reconciler/reconciler-service.ts";
import { ReconciliationScheduler } from "../../src/reconciler/reconciliation-scheduler.ts";
import { ReconciliationStore } from "../../src/reconciler/reconciliation-store.ts";
import { ResourceSpecification } from "../../src/reconciler/resource-specification.ts";
import { StaticResourceReconciler } from "../../src/reconciler/resources/static/static-reconciler.ts";
import { WebResourceReconciler } from "../../src/reconciler/resources/web/web-reconciler.ts";
import { WorkerResourceReconciler } from "../../src/reconciler/resources/worker/worker-reconciler.ts";
import { ServiceEventStore } from "../../src/reconciler/service-event-store.ts";
import { StaticStore } from "../../src/static/static-store.ts";
import { ResourceStatusService } from "../../src/status/resource-status-service.ts";
import { ServiceStorage } from "../../src/store/service-storage.ts";
import * as staticFiles from "../../src/util/file.ts";
import { atomicWriteFile, mkdir, readFile } from "../../src/util/file.ts";
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
	watchDocker = false,
) => {
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const writes: string[] = [];
	const changes = new ChangeBus();
	const state = new ServiceStorage(directory, {
		...staticFiles,
		atomicWriteFile: async (path, content, options) => {
			writes.push(path);
			await atomicWriteFile(path, content, options);
		},
	});
	const checkpoints = new ReconciliationStore(state);
	const events = new ServiceEventStore(state);
	const endpoints = new EndpointsStore(state, () => state.listServices());
	const dockerTransport = new NodeDockerTransport(
		{ socketPath: dockerSocket, timeoutMs: 2000, maxResponseBytes: 1024 * 1024 },
		sleep,
	);
	const dockerClient = new DockerClient(dockerTransport);
	const docker = new DockerService(dockerClient, config);
	const transport = new NodeEnvoyTransport({ directory, adminUrl, timeoutMs: 2000, maxResponseBytes: 1024 * 1024 });
	const envoy = new EnvoyService(
		new EnvoyClient(
			{
				createDiscoveryFile: (name, content) => transport.createDiscoveryFile(name, content),
				readConfigDump: () => transport.readConfigDump(),
				writeDiscoveryFile: async (name, content) => {
					writes.push(name);
					await transport.writeDiscoveryFile(name, content);
				},
			},
			pause,
			{ attempts: 2, intervalMs: 1 },
		),
		config,
	);
	await envoy.bootstrap();
	const networking = new NetworkingService(endpoints, envoy);
	const routing = new ResourceRoutingPolicy();
	let instance = 0;
	const generateInstanceId = () => `integration-${++instance}`;
	const deploymentContainers = new DeploymentContainers(docker, probe, pause);
	const deployments = new DeploymentService([
		new RecreateDeploymentStrategy(routing, docker, networking, deploymentContainers),
		new SurgeDeploymentStrategy(routing, docker, networking, deploymentContainers, generateInstanceId),
		...(["recreate", "surge"] as const).map(
			(name) =>
				new WorkerDeploymentStrategy(
					name,
					docker,
					deploymentContainers,
					generateInstanceId,
					new ResourceSpecification(),
				),
		),
	]);
	const git = new GitService(new GitClient(new NodeGitTransport(config)), `${directory}/git`);
	const staticStore = new StaticStore(directory, staticFiles);
	const desiredInputs = new DesiredInputs(
		routing,
		config,
		git,
		decodeDescriptorYaml,
		new EnvironmentResolver(`${directory}/env`, readFile),
	);
	const reconciler = new ReconcilerService(
		config,
		desiredInputs,
		new WebResourceReconciler(routing, new ResourceSpecification(), docker, deployments, networking, probe),
		checkpoints,
		now,
		new WorkerResourceReconciler(new ResourceSpecification(), docker, deployments, probe),
		events,
		new EventDiagnostics(config),
		changes,
		undefined,
		new StaticResourceReconciler(routing, git, staticStore, networking),
	);
	const scheduler = new ReconciliationScheduler(
		config,
		reconciler,
		checkpoints,
		desiredInputs,
		sleep,
		now,
		generateInstanceId,
		changes,
	);
	scheduler.initialize();
	const observations = new RuntimeObservations(docker, now);
	const health = new ResourceHealthService(
		config,
		git,
		decodeDescriptorYaml,
		observations,
		probe,
		changes,
		observations,
		staticStore,
	);
	const inspection = new PaasUiService(
		routing,
		new ResourceStatusService(
			new ResourceSpecification(),
			new EnvironmentResolver(`${directory}/env`, readFile),
			staticStore,
		),
		config,
		git,
		decodeDescriptorYaml,
		observations,
		checkpoints,
		events,
		health,
	);
	const cache = new CachedPaasUiService(
		inspection,
		config,
		changes,
		new HealthHistoryService(new HealthHistoryStore(state), now),
	);
	const management = new ManagementStateTask(health, cache);
	const audit = new DriftAudit(
		routing,
		config,
		desiredInputs,
		docker,
		docker,
		new ResourceSpecification(),
		scheduler,
		endpoints,
		networking,
		health,
		management,
		(id, serviceId) => watcher?.rememberNetwork(id, serviceId),
		generateInstanceId,
		staticStore,
	);
	const watcher = watchDocker
		? new DockerEventWatcher(
				new DockerEventClient(dockerTransport),
				dockerClient,
				config,
				scheduler,
				health,
				management,
				audit,
				sleep,
				generateInstanceId,
			)
		: undefined;
	const stop = async () => {
		await Promise.all([audit.stop(), watcher?.stop(), scheduler.stop()]);
	};
	onTestFinished(stop);
	if (watcher) {
		await watcher.start();
		await audit.run();
	}
	await scheduler.start();
	return {
		audit,
		stop,
		reconciler,
		scheduler,
		desiredInputs,
		git,
		refresh: new GitRefreshService(config, git, scheduler),
		checkpoints,
		endpoints,
		events,
		cache,
		management,
		writes,
		changes,
	};
};
