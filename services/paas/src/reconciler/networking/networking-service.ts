import type { IEnvoyService } from "../../envoy/envoy-service.ts";
import type { ISleep } from "../../util/sleep.ts";
import type { IEndpointsStore } from "./endpoints-store.ts";
import type { Endpoint } from "./types.ts";

export class NetworkingError extends Error {
	constructor() {
		super("Cannot update service traffic routing");
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
	/** After route acceptance, keep previous endpoints alive for the full termination
	 * budget. Returns zero remaining stop seconds once the bounded drain expires.
	 * Rejects with NetworkingError if waiting fails; callers retain both revisions.
	 */
	drain(serviceId: string, containerIds: string[], timeoutSeconds: number): Promise<number>;
}

/** Serializes complete routing snapshots across services. Store desired state first
 * so uncertain publications are retried rather than silently rolled back.
 */
export class NetworkingService implements INetworkingService {
	private pending: Promise<void> = Promise.resolve();

	constructor(
		private readonly endpoints: IEndpointsStore,
		private readonly envoy: IEnvoyService,
		private readonly sleep: ISleep,
	) {}

	routeTo(serviceId: string, endpoint: Endpoint): Promise<void> {
		return this.update(serviceId, { ...endpoint });
	}

	withdraw(serviceId: string): Promise<void> {
		return this.update(serviceId, undefined);
	}

	async drain(_serviceId: string, _containerIds: string[], timeoutSeconds: number): Promise<number> {
		try {
			await this.sleep(timeoutSeconds * 1000);
			return 0;
		} catch {
			throw new NetworkingError();
		}
	}

	private update(serviceId: string, endpoint: Endpoint | undefined): Promise<void> {
		const operation = this.pending.then(async () => {
			try {
				await this.endpoints.set(serviceId, endpoint);
				await this.envoy.configureRoutes(await this.endpoints.getAll());
			} catch {
				throw new NetworkingError();
			}
		});
		this.pending = operation.catch(() => {});
		return operation;
	}
}
