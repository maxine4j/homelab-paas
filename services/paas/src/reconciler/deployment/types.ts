import type { WebResource, WorkerResource } from "@homelab-paas/shared-contracts";

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

/** Image, environment and network identities are resolved before candidate creation. */
export interface ResolvedCandidate {
	serviceId: string;
	resourceId: string;
	revision: string;
	spec: string;
	instanceId?: string;
	imageId: string;
	networkName: string;
	resource: DeploymentWebResource | DeploymentWorkerResource;
}

export interface ReadyCandidate {
	id: string;
	address: string;
}

export interface ContainerReadinessRequest {
	serviceId: string;
	containerId: string;
	networkName: string;
	resource: DeploymentWebResource | DeploymentWorkerResource;
}

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

export type WorkloadDeploymentRequest = DeploymentRequest | WorkerDeploymentRequest;
