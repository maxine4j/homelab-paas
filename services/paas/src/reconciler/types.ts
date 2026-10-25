import type { ServiceDescriptor } from "@homelab-paas/shared-contracts";

export const serviceEventMessages = {
	fetch: "Cannot fetch descriptor; check repository, branch and committed file path",
	descriptor: "Invalid descriptor; check service identity and supported resource fields",
	capabilities:
		"Unsupported descriptor capabilities; runtime supports workers and single-replica web resources, without egress; private ingress requires auth/TLS",
	secrets: "Cannot resolve application secrets; check the service env file and required variable names",
	web: "Cannot reconcile web resource; check Docker, image, readiness and Envoy access",
	worker: "Cannot reconcile worker resource; check Docker, image and private health check",
	state: "Cannot persist reconciliation state; check platform state directory access",
	ready: "Deployment completed successfully",
	recovered: "Service recovered; clearing retry backoff",
} as const;

export interface IReconcilerService {
	/** Serializes passes; service failures are checkpointed and reported independently. */
	reconcile(): Promise<void>;
}

export interface ReconciliationState {
	desiredRevision?: string;
	activeRevision?: string;
	phase: "deploying" | "ready" | "failed";
	error?: string;
	failures?: number;
	retryAt?: number;
}

export interface IReconciliationStateStore {
	read(serviceId: string): Promise<ReconciliationState | undefined>;
	write(serviceId: string, state: ReconciliationState): Promise<void>;
}

/** Rejects invalid descriptors with a sanitized error; runtime capabilities are checked separately. */
export interface DescriptorDecoder {
	(content: string, serviceId: string): ServiceDescriptor;
}
