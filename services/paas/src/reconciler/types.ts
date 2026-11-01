import type { ServiceDescriptor, StaticResource } from "@homelab-paas/shared-contracts";

import type { DeploymentWebResource } from "./deployment/strategy/types.ts";
import type { DeploymentWorkerResource } from "./deployment/types.ts";

/** Internal only: contains resolved secrets. Never persist or send to logs/status. */
export interface DesiredService {
	revision: string;
	resources: [string, DeploymentWebResource | DeploymentWorkerResource | StaticResource][];
	secrets: string[];
}

export const serviceEventMessages = {
	started: "Deployment started; reconciling resources",
	fetch: "Cannot fetch descriptor; check repository, branch and committed file path",
	descriptor: "Invalid descriptor; check service identity and supported resource fields",
	capabilities:
		"Unsupported descriptor capabilities; runtime supports workers and single-replica web resources, without egress; private ingress requires auth/TLS",
	secrets: "Cannot resolve application secrets; check the service env file and required variable names",
	web: "Cannot reconcile web resource; check Docker, image, readiness and Envoy access",
	worker: "Cannot reconcile worker resource; check Docker, image and private health check",
	static: "Cannot reconcile static resource; check committed bundle path, storage and Envoy access",
	state: "Cannot persist reconciliation state; check platform state directory access",
	ready: "Deployment completed successfully",
	recovered: "Service recovered; clearing retry backoff",
} as const;

export interface IReconcilerService {
	/** Controlled compatibility pass for tests/internal callers; runtime work uses the targeted scheduler. */
	reconcile(): Promise<void>;
}

export interface ReconciliationState {
	desiredRevision?: string;
	activeRevision?: string;
	phase: "deploying" | "ready" | "failed";
	error?: string;
	failures?: number;
	retryAt?: number;
	/** Start of the current out-of-sync revision's five-minute deployment grace window. */
	deploymentStartedAt?: number;
}

export interface IReconciliationStateStore {
	read(serviceId: string): Promise<ReconciliationState | undefined>;
	write(serviceId: string, state: ReconciliationState): Promise<void>;
}

/** Resolves image tags at the source revision and rejects invalid descriptors with a sanitized error.
 * Revision is required when image variables are present; runtime capabilities are checked separately.
 */
export interface DescriptorDecoder {
	(content: string, serviceId: string, revision?: string): ServiceDescriptor;
}
