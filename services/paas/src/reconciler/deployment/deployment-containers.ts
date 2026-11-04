import type { IDockerService } from "../../docker/docker-service.ts";
import type { HttpProbe } from "../../util/healthcheck.ts";
import type { ISleep } from "../../util/sleep.ts";
import type { ContainerReadinessRequest, ReadyCandidate, ResolvedCandidate } from "./types.ts";

export interface IDeploymentContainers {
	/** Create and start a resolved workload, returning its freshly observed ready address.
	 * Startup/readiness failures clean only this candidate with its full termination timeout.
	 * Creation failures propagate; cleanup failures aggregate with the original failure.
	 * Callers own rollout ordering, prior candidates, routing and retention after readiness.
	 */
	startReady(candidate: ResolvedCandidate): Promise<ReadyCandidate>;
	/** Return the service-network address after at most 30 checks, one second apart.
	 * Inspection/probe failures propagate; exhaustion includes the last observed condition.
	 * Observes existing workloads without taking ownership of their cleanup.
	 */
	waitReady(request: ContainerReadinessRequest): Promise<string>;
	/** Attempt every retirement; removal follows successful graceful stop. Aggregate failures. */
	retire(
		serviceId: string,
		ids: string[],
		timeoutSeconds: number,
		message: string,
		preserveImageId?: string,
	): Promise<void>;
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

	async startReady(candidate: ResolvedCandidate): Promise<ReadyCandidate> {
		const { serviceId, resource } = candidate;
		const id = await this.docker.createResourceContainer({
			serviceId,
			resourceId: candidate.resourceId,
			revision: candidate.revision,
			spec: candidate.spec,
			instanceId: candidate.instanceId,
			imageId: candidate.imageId,
			command: resource.command,
			env: Object.fromEntries((resource.env ?? []).map(({ name, value }) => [name, value])),
			volumes: resource.volumes,
			devices: resource.devices,
			supplementaryGroups: resource.supplementaryGroups,
			selinuxLabeling: resource.selinuxLabeling,
			hostPorts: resource.hostPorts,
			limits: resource.limits,
		});
		const worker = resource.type === "worker";
		try {
			await this.docker.startServiceContainer(serviceId, id);
			const address = await this.waitReady({
				serviceId,
				containerId: id,
				networkName: candidate.networkName,
				resource,
			});
			return { id, address };
		} catch (failure) {
			return this.cleanupFailed(
				serviceId,
				[id],
				resource.termination?.timeoutSeconds ?? 30,
				failure,
				worker ? "Worker startup and cleanup failed" : "Replacement startup and cleanup failed",
			);
		}
	}

	async waitReady(request: ContainerReadinessRequest): Promise<string> {
		const { resource } = request;
		const worker = resource.type === "worker";
		const port = resource.type === "web" ? resource.ingress.port : resource.healthcheckPort;
		let reason = "container is no longer present";
		for (let attempt = 0; attempt < 30; attempt++) {
			const container = await this.docker.inspectServiceContainer(request.serviceId, request.containerId);
			const address = container?.networks[request.networkName]?.address;
			if (!container) reason = "container is no longer present";
			else if (!container.running) reason = "container is not running";
			else if (!address) reason = "container has no address on the service network";
			else if (!resource.healthcheckUrl || (await this.probe(address, port, resource.healthcheckUrl)))
				return address;
			else
				reason = `${worker ? "private" : "HTTP"} health check on port ${port} at ${resource.healthcheckUrl} did not pass`;
			if (attempt < 29) await this.sleep(1000);
		}
		throw new Error(`${worker ? "Worker" : "Container"} readiness failed after 30 checks: ${reason}`);
	}

	async retire(
		serviceId: string,
		ids: string[],
		timeoutSeconds: number,
		message: string,
		preserveImageId?: string,
	): Promise<void> {
		const results = await Promise.allSettled(
			ids.map(async (id) => {
				await this.docker.stopServiceContainer(serviceId, id, timeoutSeconds);
				if (preserveImageId === undefined) await this.docker.removeServiceContainer(serviceId, id);
				else await this.docker.removeServiceContainer(serviceId, id, preserveImageId);
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
