import type { WorkerResource } from "@homelab-paas/shared-contracts";

/** Secret references are resolved before fingerprinting or deployment. */
export type DeploymentWorkerResource = Omit<WorkerResource, "env"> & {
	env?: { name: string; value: string }[];
};

export interface WorkerDeploymentRequest {
	force?: boolean;
	serviceId: string;
	resourceId: string;
	revision: string;
	spec: string;
	resource: DeploymentWorkerResource;
}
