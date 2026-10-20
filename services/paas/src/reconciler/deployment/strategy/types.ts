import type { WebResource } from "@homelab-paas/shared-contracts";

export interface DeploymentRequest {
	serviceId: string;
	resourceId: string;
	revision: string;
	spec: string;
	resource: WebResource;
}

/** A complete rollout. Resolves only after the replacement is ready and routed.
 * Failures propagate to the caller, which owns retry scheduling and status.
 */
export interface DeploymentStrategy {
	readonly name: "recreate" | "surge" | "eternal";
	deploy(request: DeploymentRequest): Promise<void>;
}
