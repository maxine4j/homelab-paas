import type { DeploymentRequest, DeploymentStrategy } from "./strategy/types.ts";

export interface IDeploymentService {
	/** Select the configured strategy and await rollout. Failures propagate. */
	deploy(request: DeploymentRequest): Promise<void>;
}

export class DeploymentService implements IDeploymentService {
	private readonly strategies = new Map<string, DeploymentStrategy>();

	constructor(strategies: readonly DeploymentStrategy[]) {
		for (const strategy of strategies) {
			if (this.strategies.has(strategy.name)) throw new Error("Duplicate deployment strategy");
			this.strategies.set(strategy.name, strategy);
		}
	}

	async deploy(request: DeploymentRequest): Promise<void> {
		const strategy = this.strategies.get(request.resource.rolloutStrategy ?? "recreate");
		if (!strategy) throw new Error("Deployment strategy is not available");
		await strategy.deploy(request);
	}
}
