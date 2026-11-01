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
					selinuxLabeling: resource.selinuxLabeling,
					hostPorts: resource.hostPorts,
					limits: resource.limits,
				});
				created.push(id);
				await this.docker.startServiceContainer(serviceId, id);
				await this.waitReady(request, id, network.name);
			}
		} catch (failure) {
			return this.containers.cleanupFailed(
				serviceId,
				created,
				resource.termination?.timeoutSeconds ?? 30,
				failure,
				"Worker startup and cleanup failed",
			);
		}
		if (resource.rolloutStrategy === "surge") await this.retire(request, retiring);
	}

	private async waitReady(request: WorkerDeploymentRequest, id: string, networkName: string): Promise<void> {
		const { serviceId, resource } = request;
		await this.containers.waitReady({
			serviceId,
			containerId: id,
			networkName,
			failureMessage: "Worker readiness failed",
			healthcheck: resource.healthcheckUrl
				? {
						port: resource.healthcheckPort,
						path: resource.healthcheckUrl,
						failureMessage: `private health check on port ${resource.healthcheckPort} at ${resource.healthcheckUrl} did not pass`,
					}
				: undefined,
		});
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
