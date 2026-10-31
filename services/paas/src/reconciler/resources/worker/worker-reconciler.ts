import type { IDockerService } from "../../../docker/docker-service.ts";
import type { HttpProbe } from "../../../util/healthcheck.ts";
import { createLogger } from "../../../util/logger.ts";
import type { IWorkerDeploymentService } from "../../deployment/worker-deployment-service.ts";
import type { IResourceSpecification } from "../../resource-specification.ts";
import type { WorkerReconciliationRequest } from "./types.ts";

export interface IWorkerResourceReconciler {
	readonly type: "worker";
	readonly lifecycle: "deployment";
	/** Checks running replicas and any configured private HTTP readiness; delegates drift repair. Failures propagate. */
	reconcile(request: WorkerReconciliationRequest): Promise<void>;
}

export class WorkerResourceReconciler implements IWorkerResourceReconciler {
	private readonly log = createLogger(WorkerResourceReconciler.name);
	readonly type = "worker";
	readonly lifecycle = "deployment";

	constructor(
		private readonly specification: IResourceSpecification,
		private readonly docker: IDockerService,
		private readonly deployment: IWorkerDeploymentService,
		private readonly probe: HttpProbe,
	) {}

	async reconcile(request: WorkerReconciliationRequest): Promise<void> {
		const { serviceId, resourceId, resource } = request;
		const spec = this.specification.get(resourceId, resource);
		const containers = await this.docker.listServiceContainers(serviceId, resourceId);
		if (
			!request.force
			&& containers.length === (resource.replicas ?? 1)
			&& containers.every((container) => container.spec === spec && container.state === "running")
		) {
			await this.docker.prepareServiceNetwork(serviceId);
			const network = await this.docker.inspectServiceNetwork(serviceId);
			let connected = Boolean(network);
			for (const current of containers) {
				const container = await this.docker.inspectServiceContainer(serviceId, current.id);
				const address = network && container?.networks[network.name]?.address;
				if (!network || !container?.running || !network.containerIds.includes(current.id) || !address) {
					connected = false;
					break;
				}
				if (
					resource.healthcheckUrl
					&& !(await this.probe(address, resource.healthcheckPort, resource.healthcheckUrl))
				)
					throw new Error(
						`Worker readiness failed: private health check on port ${resource.healthcheckPort} at ${resource.healthcheckUrl} did not pass`,
					);
			}
			if (connected) return;
		}
		this.log.info(
			{
				event: "resource.drift",
				serviceId,
				resourceId,
				revision: request.revision,
				strategy: resource.rolloutStrategy ?? "recreate",
			},
			"Detected worker resource drift; reconciling replicas",
		);
		await this.deployment.deploy({ ...request, spec });
	}
}
