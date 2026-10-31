import type { Resource, HealthStatus } from "@homelab-paas/shared-contracts";

import type { IPaasConfig } from "../config/paas-config.ts";
import type { ServiceContainer } from "../docker/types.ts";
import type { IChangeBus } from "../events/change-bus.ts";
import type { IGitService } from "../git/git-service.ts";
import type { DescriptorDecoder } from "../reconciler/types.ts";
import type { PeriodicTask } from "../task/periodic.ts";
import type { HttpProbe } from "../util/healthcheck.ts";
import { createLogger } from "../util/logger.ts";
import type { HealthDocker, HealthObservation } from "./types.ts";

export interface IResourceHealthReader {
	/** Returns latest health only for the same observed container identities and states. */
	getStatus(serviceId: string, resourceId: string, containers: readonly ServiceContainer[]): HealthStatus;
}

export interface IResourceHealthProgress {
	started(serviceId: string, resourceId: string): void;
	finished(serviceId: string, resourceId: string): void;
}

/** Live health is independent of reconciliation backoff and is not persisted across process restarts. */
export class ResourceHealthService implements IResourceHealthReader, IResourceHealthProgress, PeriodicTask {
	private readonly log = createLogger(ResourceHealthService.name);
	private readonly observations = new Map<string, HealthObservation>();
	private readonly deploying = new Set<string>();
	private readonly generations = new Map<string, symbol>();

	constructor(
		private readonly config: IPaasConfig,
		private readonly git: IGitService,
		private readonly decode: DescriptorDecoder,
		private readonly docker: HealthDocker,
		private readonly probe: HttpProbe,
		private readonly changes: IChangeBus,
	) {}

	getStatus(serviceId: string, resourceId: string, containers: readonly ServiceContainer[]): HealthStatus {
		const key = `${serviceId}/${resourceId}`;
		if (this.deploying.has(key)) return "Progressing";
		if (!containers.length) return "Missing";
		const observation = this.observations.get(key);
		return observation?.signature === this.signature(containers) ? observation.health : "Unknown";
	}

	started(serviceId: string, resourceId: string): void {
		const key = `${serviceId}/${resourceId}`;
		this.deploying.add(key);
		this.invalidate(key);
		this.changes.publish({ serviceId });
	}

	finished(serviceId: string, resourceId: string): void {
		const key = `${serviceId}/${resourceId}`;
		this.deploying.delete(key);
		this.invalidate(key);
		this.changes.publish({ serviceId });
	}

	async run(): Promise<void> {
		const services = this.config.getServices();
		for (const key of this.observations.keys()) {
			if (!Object.hasOwn(services, key.split("/")[0]!)) this.observations.delete(key);
		}
		await Promise.all(
			Object.entries(services).map(async ([serviceId, source]) => {
				try {
					const [file, containers] = await Promise.all([
						this.git.fetchFile(serviceId, source),
						this.docker.listServiceContainers(serviceId),
					]);
					const resources = this.decode(file.content, serviceId, file.revision).resources;
					const ids = new Set([...Object.keys(resources), ...containers.map(({ resourceId }) => resourceId)]);
					for (const key of this.observations.keys()) {
						if (key.startsWith(`${serviceId}/`) && !ids.has(key.slice(serviceId.length + 1)))
							this.observations.delete(key);
					}
					await Promise.all(
						[...ids].map(async (resourceId) => {
							const key = `${serviceId}/${resourceId}`;
							if (this.deploying.has(key)) return;
							const generation = this.generations.get(key);
							const current = containers.filter((container) => container.resourceId === resourceId);
							const signature = this.signature(current);
							let health: HealthStatus;
							try {
								health = await this.check(serviceId, resources[resourceId], current);
							} catch (err) {
								this.log.error({ err, serviceId, resourceId }, "Cannot inspect resource health");
								health = "Unknown";
							}
							if (this.generations.get(key) !== generation) return;
							const previous = this.observations.get(key);
							this.observations.set(key, { health, signature });
							if (previous?.health !== health || previous.signature !== signature)
								this.changes.publish({ serviceId });
						}),
					);
				} catch (err) {
					this.log.error({ err, serviceId }, "Cannot poll service resource health");
					let changed = false;
					for (const key of this.observations.keys()) {
						if (key.startsWith(`${serviceId}/`)) {
							this.observations.delete(key);
							changed = true;
						}
					}
					if (changed) this.changes.publish({ serviceId });
				}
			}),
		);
	}

	private async check(
		serviceId: string,
		resource: Resource | undefined,
		containers: ServiceContainer[],
	): Promise<HealthStatus> {
		if (!containers.length) return "Missing";
		if (!resource || (resource.type !== "web" && resource.type !== "worker")) return "Unknown";
		if (containers.length !== (resource.replicas ?? 1) || containers.some(({ state }) => state !== "running"))
			return "Degraded";
		if (!resource.healthcheckUrl) return "Healthy";
		const healthcheckUrl = resource.healthcheckUrl;
		const network = await this.docker.inspectServiceNetwork(serviceId);
		if (!network) return "Degraded";
		const results = await Promise.all(
			containers.map(async ({ id }) => {
				const container = await this.docker.inspectServiceContainer(serviceId, id);
				const address = container?.networks[network.name]?.address;
				return Boolean(
					container?.running
					&& address
					&& network.containerIds.includes(id)
					&& (await this.probe(
						address,
						resource.type === "web" ? resource.ingress.port : resource.healthcheckPort,
						healthcheckUrl,
					)),
				);
			}),
		);
		return results.every(Boolean) ? "Healthy" : "Degraded";
	}

	private signature(containers: readonly ServiceContainer[]): string {
		return JSON.stringify(containers.map(({ id, state }) => [id, state]).sort(([a], [b]) => a!.localeCompare(b!)));
	}

	private invalidate(key: string): void {
		this.generations.set(key, Symbol());
		this.observations.delete(key);
	}
}
