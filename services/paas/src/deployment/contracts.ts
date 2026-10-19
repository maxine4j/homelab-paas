import type { WebResource } from "@homelab-paas/shared-contracts";
export interface GitSource {
	remote: string;
	branch?: string;
	descriptorPath: string;
}

export class DeploymentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DeploymentError";
	}
}
export interface DescriptorSource {
	/** Reads the descriptor from a fixed commit. Throws DeploymentError on failure. */
	read(serviceId: string, source: GitSource): Promise<{ revision: string; content: string }>;
}
export interface Container {
	id: string;
	resourceId: string;
	revision: string;
	spec: string;
	running: boolean;
}
export interface Endpoint {
	address: string;
	port: number;
	healthcheckPath?: string;
}
export interface WorkloadClient {
	/** All operations throw DeploymentError. Objects are scoped by cluster/service labels. */
	prepareNetwork(serviceId: string): Promise<void>;
	list(serviceId: string): Promise<Container[]>;
	resolveImage(image: string): Promise<string>;
	create(
		serviceId: string,
		resourceId: string,
		revision: string,
		spec: string,
		resource: WebResource,
		imageId: string,
	): Promise<string>;
	start(containerId: string): Promise<void>;
	stop(containerId: string, timeoutSeconds: number): Promise<void>;
	remove(containerId: string): Promise<void>;
	waitReady(containerId: string, resource: WebResource): Promise<Endpoint>;
}
export interface RouteStore {
	/** Publishes a ready endpoint, or withdraws it before recreate. Throws DeploymentError. */
	set(serviceId: string, endpoint: Endpoint | undefined): Promise<void>;
}
export interface DeploymentStatus {
	desiredRevision?: string;
	activeRevision?: string;
	phase: "pending" | "deploying" | "ready" | "failed";
	error?: string;
}
export interface StateStore {
	/** Persists a checkpoint without credentials. Throws DeploymentError. */
	write(serviceId: string, state: DeploymentStatus): Promise<void>;
}
