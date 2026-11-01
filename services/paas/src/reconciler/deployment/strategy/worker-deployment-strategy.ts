import type { IDockerService } from "../../../docker/docker-service.ts";
import type { IResourceSpecification } from "../../resource-specification.ts";
import type { IDeploymentContainers } from "../deployment-containers.ts";
import type { WorkerDeploymentRequest } from "../types.ts";
import type { DeploymentStrategy } from "./types.ts";

/** Workers have no routing dependency; their health endpoints are only probed by PaaS. */
export class WorkerDeploymentStrategy implements DeploymentStrategy<WorkerDeploymentRequest> {
	readonly resourceType = "worker";
	constructor(
		readonly name: "recreate" | "surge",
		private readonly docker: IDockerService,
		private readonly containers: IDeploymentContainers,
		private readonly generateInstanceId: () => string,
		private readonly specification: IResourceSpecification,
	) {}

	async deploy(request: WorkerDeploymentRequest): Promise<void> {
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
		if (this.name === "recreate") await this.retire(request, retiring);
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
		if (this.name === "surge") await this.retire(request, retiring);
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
