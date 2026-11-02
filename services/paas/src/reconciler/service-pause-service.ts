import type { ServiceContainer } from "../docker/types.ts";

export interface IPauseDocker {
	listServiceContainers(serviceId: string): Promise<ServiceContainer[]>;
	stopServiceContainer(serviceId: string, containerId: string, timeoutSeconds: number): Promise<void>;
}

export interface IServicePauseService {
	/** Withdraws all service routes and stops every live owned container, retaining data.
	 * Attempts all shutdown operations; rejects if any operation fails. Safe to retry.
	 */
	enforce(serviceId: string): Promise<void>;
}

export class ServicePauseService implements IServicePauseService {
	constructor(
		private readonly docker: IPauseDocker,
		private readonly networking: { withdraw(serviceId: string): Promise<void> },
	) {}
	async enforce(serviceId: string): Promise<void> {
		const failures: unknown[] = [];
		try {
			await this.networking.withdraw(serviceId);
		} catch (error) {
			failures.push(error);
		}
		try {
			for (const container of await this.docker.listServiceContainers(serviceId)) {
				if (["exited", "dead", "created"].includes(container.state)) continue;
				try {
					await this.docker.stopServiceContainer(serviceId, container.id, 30);
				} catch (error) {
					failures.push(error);
				}
			}
		} catch (error) {
			failures.push(error);
		}
		if (failures.length) throw new AggregateError(failures, "Cannot fully pause service");
	}
}
