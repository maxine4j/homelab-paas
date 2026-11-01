import { createLogger } from "../../util/logger.ts";
import type { IDeploymentProgress } from "../deployment-progress.ts";
import type { RegisteredDeploymentStrategy } from "./strategy/types.ts";
import type { WorkloadDeploymentRequest } from "./types.ts";

export interface IDeploymentService {
	/** Select the configured strategy and await rollout. Failures propagate. */
	deploy(request: WorkloadDeploymentRequest): Promise<void>;
}

export class DeploymentService implements IDeploymentService {
	private readonly log = createLogger(DeploymentService.name);
	private readonly strategies = new Map<string, RegisteredDeploymentStrategy>();

	constructor(
		strategies: readonly RegisteredDeploymentStrategy[],
		private readonly progress?: IDeploymentProgress,
	) {
		for (const strategy of strategies) {
			const key = `${strategy.resourceType}:${strategy.name}`;
			if (this.strategies.has(key)) throw new Error("Duplicate deployment strategy");
			this.strategies.set(key, strategy);
		}
	}

	async deploy(request: WorkloadDeploymentRequest): Promise<void> {
		const strategy = this.strategies.get(
			`${request.resource.type}:${request.resource.rolloutStrategy ?? "recreate"}`,
		);
		if (!strategy) throw new Error("Deployment strategy is not available");
		const fields = {
			serviceId: request.serviceId,
			resourceId: request.resourceId,
			revision: request.revision,
			strategy: strategy.name,
			resourceType: request.resource.type,
		};
		this.log.info({ ...fields, event: "deployment.started" }, "Deploying workload replacement");
		try {
			await this.progress?.started(request.serviceId, request.resourceId, request.revision);
			if (strategy.resourceType === "web" && request.resource.type === "web")
				await strategy.deploy({ ...request, resource: request.resource });
			else if (strategy.resourceType === "worker" && request.resource.type === "worker")
				await strategy.deploy({ ...request, resource: request.resource });
			else throw new Error("Deployment strategy does not support resource type");
			await this.progress?.succeeded(request.serviceId, request.resourceId, request.revision);
			this.log.info(
				{ ...fields, event: "deployment.completed" },
				"Deployment ready; previous containers retired",
			);
		} catch (error) {
			await this.progress?.failed(request.serviceId, request.resourceId, request.revision);
			this.log.error(
				{ ...fields, event: "deployment.failed", err: error },
				"Deployment failed; reconciliation will retry from observed state",
			);
			throw error;
		}
	}
}
