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
	/** Stop assigning new requests before stopping containers. Resource withdrawal also removes unowned legacy service routes. Rejects with NetworkingError. */
	withdraw(serviceId: string): Promise<void>;
}

export interface IRouteVerifier {
	/** Startup/audit forces xDS repair and confirmation. An optional complete desired snapshot repairs persisted routing;
	 * callers must retain routes outside their supported inventory, including removed services. */
	verifyRoutes(expected?: Record<string, Endpoint>): Promise<void>;
}

/** Serializes complete routing snapshots across services. Store desired state first
 * so uncertain publications are retried rather than silently rolled back.
 */
export class NetworkingService implements INetworkingService, IRouteVerifier {
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

	verifyRoutes(expected?: Record<string, Endpoint>): Promise<void> {
		const snapshot = expected && structuredClone(expected);
		const operation = this.pending.then(async () => {
			try {
				if (snapshot) {
					const persisted = await this.endpoints.getAll();
					for (const id of Object.keys(persisted)) {
						if (!Object.hasOwn(snapshot, id)) await this.endpoints.set(id, undefined);
					}
					for (const [id, endpoint] of Object.entries(snapshot)) await this.endpoints.set(id, endpoint);
				}
				await this.envoy.configureRoutes(await this.endpoints.getAll(), true);
			} catch (cause) {
				throw new NetworkingError({ cause });
			}
		});
		this.pending = operation.catch(() => {});
		return operation;
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
