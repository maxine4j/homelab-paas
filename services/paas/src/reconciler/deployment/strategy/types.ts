import type { WebResource } from "@homelab-paas/shared-contracts";

/** Environment references must be resolved and validated before invoking deployment adapters. */
export type DeploymentWebResource = Omit<WebResource, "env"> & {
	env?: { name: string; value: string }[];
};

export interface DeploymentRequest {
	serviceId: string;
	resourceId: string;
	revision: string;
	spec: string;
	resource: DeploymentWebResource;
}

/** A complete rollout. Resolves only after the replacement is ready and routed.
 * Failures propagate to the caller, which owns retry scheduling and status.
 */
export interface DeploymentStrategy {
	readonly name: "recreate" | "surge" | "eternal";
	deploy(request: DeploymentRequest): Promise<void>;
}
