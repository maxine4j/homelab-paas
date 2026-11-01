import type { IDockerService } from "../../docker/docker-service.ts";
import type { HttpProbe } from "../../util/healthcheck.ts";
import type { ISleep } from "../../util/sleep.ts";
import type { ContainerReadinessRequest } from "./types.ts";

export interface IDeploymentContainers {
	/** Return the service-network address after at most 30 checks, one second apart.
	 * Inspection/probe failures propagate; exhaustion includes the last observed condition.
	 */
	waitReady(request: ContainerReadinessRequest): Promise<string>;
	/** Attempt every retirement; removal follows successful graceful stop. Aggregate failures. */
	retire(serviceId: string, ids: string[], timeoutSeconds: number, message: string): Promise<void>;
	/** Clean failed candidates and rethrow the original failure, aggregating cleanup failures. */
	cleanupFailed(
		serviceId: string,
		ids: string[],
		timeoutSeconds: number,
		failure: unknown,
		message: string,
	): Promise<never>;
}

export class DeploymentContainers implements IDeploymentContainers {
	constructor(
		private readonly docker: IDockerService,
		private readonly probe: HttpProbe,
		private readonly sleep: ISleep,
	) {}

	async waitReady(request: ContainerReadinessRequest): Promise<string> {
		let reason = "container is no longer present";
		for (let attempt = 0; attempt < 30; attempt++) {
			const container = await this.docker.inspectServiceContainer(request.serviceId, request.containerId);
			const address = container?.networks[request.networkName]?.address;
			if (!container) reason = "container is no longer present";
			else if (!container.running) reason = "container is not running";
			else if (!address) reason = "container has no address on the service network";
			else if (
				!request.healthcheck
				|| (await this.probe(address, request.healthcheck.port, request.healthcheck.path))
			)
				return address;
			else reason = request.healthcheck.failureMessage;
			if (attempt < 29) await this.sleep(1000);
		}
		throw new Error(`${request.failureMessage} after 30 checks: ${reason}`);
	}

	async retire(serviceId: string, ids: string[], timeoutSeconds: number, message: string): Promise<void> {
		const results = await Promise.allSettled(
			ids.map(async (id) => {
				await this.docker.stopServiceContainer(serviceId, id, timeoutSeconds);
				await this.docker.removeServiceContainer(serviceId, id);
			}),
		);
		const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
		if (failures.length) throw new AggregateError(failures, message);
	}

	async cleanupFailed(
		serviceId: string,
		ids: string[],
		timeoutSeconds: number,
		failure: unknown,
		message: string,
	): Promise<never> {
		try {
			await this.retire(serviceId, ids, timeoutSeconds, "Candidate cleanup failed");
		} catch (cleanupFailure) {
			throw new AggregateError([failure, cleanupFailure], message);
		}
		throw failure;
	}
}
