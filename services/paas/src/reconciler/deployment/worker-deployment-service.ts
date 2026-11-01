import type { IDockerService } from "../../docker/docker-service.ts";
import { createLogger } from "../../util/logger.ts";
import type { IDeploymentProgress } from "../deployment-progress.ts";
import type { IResourceSpecification } from "../resource-specification.ts";
import type { IDeploymentContainers } from "./deployment-containers.ts";
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
		private readonly containers: IDeploymentContainers,
		private readonly generateInstanceId: () => string,
		private readonly specification: IResourceSpecification,
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
			await this.progress?.failed(request.serviceId, request.resourceId, request.revision);
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
		const retained = [];
		for (const container of current) {
			if (
				!request.force
				&& container.spec === request.spec
				&& container.state === "running"
				&& retained.length < (resource.replicas ?? 1)
				&& this.specification.matchesRuntime(
					resourceId,
					resource,
					await this.docker.inspectServiceContainer(serviceId, container.id),
					network,
				)
			)
				retained.push(container);
		}
		const retainedIds = new Set(retained.map(({ id }) => id));
		const retiring = current.filter(({ id }) => !retainedIds.has(id)).map(({ id }) => id);
		const missing = (resource.replicas ?? 1) - retained.length;
		const imageId = missing > 0 ? await this.docker.resolveImage(resource.image) : undefined;
		for (const { id } of retained)
			await this.containers.waitReady({
				serviceId,
				containerId: id,
				networkName: network.name,
				resource,
			});
		if ((resource.rolloutStrategy ?? "recreate") === "recreate") await this.retire(request, retiring);
		// startReady owns a failed replica; this ledger owns earlier ready replicas.
		const readyCandidates: string[] = [];
		try {
			for (let replica = 0; replica < missing; replica++) {
				const { id } = await this.containers.startReady({
					serviceId,
					resourceId,
					revision: request.revision,
					spec: request.spec,
					instanceId: this.generateInstanceId(),
					imageId: imageId!,
					networkName: network.name,
					resource,
				});
				readyCandidates.push(id);
			}
		} catch (failure) {
			return this.containers.cleanupFailed(
				serviceId,
				readyCandidates,
				resource.termination?.timeoutSeconds ?? 30,
				failure,
				"Worker startup and cleanup failed",
			);
		}
		if (resource.rolloutStrategy === "surge") await this.retire(request, retiring);
	}

	private async retire(request: WorkerDeploymentRequest, ids: string[]): Promise<void> {
		await this.containers.retire(
			request.serviceId,
			ids,
			request.resource.termination?.timeoutSeconds ?? 30,
			"Worker retirement failed",
		);
	}
}
