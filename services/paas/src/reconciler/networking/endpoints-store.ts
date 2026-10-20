import type { Endpoint } from "./types.ts";

/** Desired endpoints, including changes whose publication outcome is uncertain. */
export interface IEndpointsStore {
	getAll(): Promise<Record<string, Endpoint>>;
	set(serviceId: string, endpoint: Endpoint | undefined): Promise<void>;
}

export class InMemoryEndpointsStore implements IEndpointsStore {
	private readonly endpoints = new Map<string, Endpoint>();

	async getAll(): Promise<Record<string, Endpoint>> {
		return Object.fromEntries([...this.endpoints].map(([id, endpoint]) => [id, { ...endpoint }]));
	}

	async set(serviceId: string, endpoint: Endpoint | undefined): Promise<void> {
		if (endpoint) this.endpoints.set(serviceId, { ...endpoint });
		else this.endpoints.delete(serviceId);
	}
}
