import type { IDockerService } from "../../docker/docker-service.ts";
import type { HttpProbe } from "../../util/healthcheck.ts";
import { createLogger } from "../../util/logger.ts";
import type { ISleep } from "../../util/sleep.ts";
import type { IDeploymentProgress } from "../deployment-progress.ts";
import type { WorkerDeploymentRequest } from "./types.ts";

export interface IWorkerDeploymentService {
	/** Deploy all replicas and establish private HTTP readiness before retiring surge predecessors.
	 * Failures propagate to reconciliation, which owns retry scheduling.
	 */
	deploy(request: WorkerDeploymentRequest): Promise<void>;
}

/** Workers have no routing dependency; their health endpoints are only probed by PaaS. */
export class WorkerDeploymentService implements IWorkerDeploymentService {
	private readonly log = createLogger(WorkerDeploymentService.name);
	constructor(
		private readonly docker: IDockerService,
		private readonly probe: HttpProbe,
		private readonly sleep: ISleep,
		private readonly generateInstanceId: () => string,
		private readonly progress?: IDeploymentProgress,
	) {}

	async deploy(request: WorkerDeploymentRequest): Promise<void> {
		const fields = {
			serviceId: request.serviceId,
			resourceId: request.resourceId,
			revision: request.revision,
			strategy: request.resource.rolloutStrategy ?? "recreate",
		};
		this.log.info({ ...fields, event: "deployment.started" }, "Deploying worker replicas");
		try {
			await this.progress?.started(request.serviceId, request.resourceId, request.revision);
			await this.deployReplicas(request);
			await this.progress?.succeeded(request.serviceId, request.resourceId, request.revision);
			this.log.info(
				{ ...fields, event: "deployment.completed" },
				"Worker replicas ready; previous containers retired",
			);
		} catch (err) {
			this.log.error(
				{ ...fields, event: "deployment.failed", err },
				"Worker deployment failed; reconciliation will retry",
			);
			throw err;
		}
	}

	private async deployReplicas(request: WorkerDeploymentRequest): Promise<void> {
		const { serviceId, resourceId, resource } = request;
		const current = await this.docker.listServiceContainers(serviceId, resourceId);
		await this.docker.prepareServiceNetwork(serviceId);
		const network = await this.docker.inspectServiceNetwork(serviceId);
		if (!network) throw new Error("Service network is unavailable");
		const retained = current
			.filter(
				({ id, spec, state }) =>
					!request.force && spec === request.spec && state === "running" && network.containerIds.includes(id),
			)
			.slice(0, resource.replicas ?? 1);
		const retainedIds = new Set(retained.map(({ id }) => id));
		const retiring = current.filter(({ id }) => !retainedIds.has(id)).map(({ id }) => id);
		const missing = (resource.replicas ?? 1) - retained.length;
		const imageId = missing > 0 ? await this.docker.resolveImage(resource.image) : undefined;
		for (const { id } of retained) await this.waitReady(request, id, network.name);
		if ((resource.rolloutStrategy ?? "recreate") === "recreate") await this.retire(request, retiring);
		const created: string[] = [];
		try {
			for (let replica = 0; replica < missing; replica++) {
				const id = await this.docker.createResourceContainer({
					serviceId,
					resourceId,
					revision: request.revision,
					spec: request.spec,
					instanceId: this.generateInstanceId(),
					imageId: imageId!,
					command: resource.command,
					env: Object.fromEntries((resource.env ?? []).map(({ name, value }) => [name, value])),
					volumes: resource.volumes,
					devices: resource.devices,
					supplementaryGroups: resource.supplementaryGroups,
					hostPorts: resource.hostPorts,
					limits: resource.limits,
				});
				created.push(id);
				await this.docker.startServiceContainer(serviceId, id);
				await this.waitReady(request, id, network.name);
			}
		} catch (failure) {
			try {
				await this.retire(request, created);
			} catch (cleanupFailure) {
				throw new AggregateError([failure, cleanupFailure], "Worker startup and cleanup failed");
			}
			throw failure;
		}
		if (resource.rolloutStrategy === "surge") await this.retire(request, retiring);
	}

	private async waitReady(request: WorkerDeploymentRequest, id: string, networkName: string): Promise<void> {
		for (let attempt = 0; attempt < 30; attempt++) {
			const container = await this.docker.inspectServiceContainer(request.serviceId, id);
			const address = container?.networks[networkName]?.address;
			if (
				container?.running
				&& address
				&& (await this.probe(
					address,
					request.resource.healthcheckPort,
					request.resource.healthcheckUrl ?? "/healthcheck",
				))
			)
				return;
			if (attempt < 29) await this.sleep(1000);
		}
		throw new Error("Worker readiness failed; check container startup and private health check");
	}

	private async retire(request: WorkerDeploymentRequest, ids: string[]): Promise<void> {
		const results = await Promise.allSettled(
			ids.map(async (id) => {
				await this.docker.stopServiceContainer(
					request.serviceId,
					id,
					request.resource.termination?.timeoutSeconds ?? 30,
				);
				await this.docker.removeServiceContainer(request.serviceId, id);
			}),
		);
		const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
		if (failures.length) throw new AggregateError(failures, "Worker retirement failed");
	}
}
