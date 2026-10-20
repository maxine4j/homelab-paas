import type { ServiceDescriptor } from "@homelab-paas/shared-contracts";

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

/** Rejects invalid or unsupported descriptors with a sanitized error. */
export interface DescriptorDecoder {
	(content: string, serviceId: string): ServiceDescriptor;
}
