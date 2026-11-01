import type { DeploymentRequest, WorkerDeploymentRequest } from "../types.ts";

/** A complete rollout. Web replacements must also have their route accepted.
 * Failures propagate to the caller, which owns retry scheduling and status.
 */
export interface DeploymentStrategy<T extends DeploymentRequest | WorkerDeploymentRequest = DeploymentRequest> {
	readonly resourceType: T["resource"]["type"];
	readonly name: "recreate" | "surge" | "eternal";
	deploy(request: T): Promise<void>;
}

export type RegisteredDeploymentStrategy = DeploymentStrategy | DeploymentStrategy<WorkerDeploymentRequest>;
