import type { IEnvoyService } from "../../envoy/envoy-service.ts";
import type { IEndpointsStore } from "./endpoints-store.ts";
import type { Endpoint } from "./types.ts";

export class NetworkingError extends Error {
	constructor(options?: ErrorOptions) {
		super("Cannot update service traffic routing", options);
		this.name = "NetworkingError";
	}
}

export interface INetworkingService {
	/** Replace the destination only after readiness. Resolves after Envoy acceptance.
	 * Rejects with NetworkingError; publication may have occurred. Keep both containers.
	 */
	routeTo(serviceId: string, endpoint: Endpoint): Promise<void>;
	/** Stop assigning new requests before stopping containers. Rejects with NetworkingError. */
	withdraw(serviceId: string): Promise<void>;
}

/** Serializes complete routing snapshots across services. Store desired state first
 * so uncertain publications are retried rather than silently rolled back.
 */
export class NetworkingService implements INetworkingService {
	private pending: Promise<void> = Promise.resolve();

	constructor(
		private readonly endpoints: IEndpointsStore,
		private readonly envoy: IEnvoyService,
	) {}

	routeTo(serviceId: string, endpoint: Endpoint): Promise<void> {
		return this.update(serviceId, { ...endpoint });
	}

	withdraw(serviceId: string): Promise<void> {
		return this.update(serviceId, undefined);
	}

	private update(serviceId: string, endpoint: Endpoint | undefined): Promise<void> {
		const operation = this.pending.then(async () => {
			try {
				await this.endpoints.set(serviceId, endpoint);
				await this.envoy.configureRoutes(await this.endpoints.getAll());
			} catch (cause) {
				throw new NetworkingError({ cause });
			}
		});
		this.pending = operation.catch(() => {});
		return operation;
	}
}
