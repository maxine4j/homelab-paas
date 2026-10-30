import { createLogger } from "../../util/logger.ts";
import type { IDeploymentProgress } from "../deployment-progress.ts";
import type { DeploymentRequest, DeploymentStrategy } from "./strategy/types.ts";

export interface IDeploymentService {
	/** Select the configured strategy and await rollout. Failures propagate. */
	deploy(request: DeploymentRequest): Promise<void>;
}

export class DeploymentService implements IDeploymentService {
	private readonly log = createLogger(DeploymentService.name);
	private readonly strategies = new Map<string, DeploymentStrategy>();

	constructor(
		strategies: readonly DeploymentStrategy[],
		private readonly progress?: IDeploymentProgress,
	) {
		for (const strategy of strategies) {
			if (this.strategies.has(strategy.name)) throw new Error("Duplicate deployment strategy");
			this.strategies.set(strategy.name, strategy);
		}
	}

	async deploy(request: DeploymentRequest): Promise<void> {
		const strategy = this.strategies.get(request.resource.rolloutStrategy ?? "recreate");
		if (!strategy) throw new Error("Deployment strategy is not available");
		const fields = {
			serviceId: request.serviceId,
			resourceId: request.resourceId,
			revision: request.revision,
			strategy: strategy.name,
		};
		this.log.info(
			{ ...fields, event: "deployment.started" },
			"Deploying replacement; resolving image and preparing service network",
		);
		try {
			await this.progress?.started(request.serviceId, request.resourceId, request.revision);
			await strategy.deploy(request);
			await this.progress?.succeeded(request.serviceId, request.resourceId, request.revision);
			this.log.info(
				{ ...fields, event: "deployment.completed" },
				"Deployment ready; route accepted and previous containers retired",
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
