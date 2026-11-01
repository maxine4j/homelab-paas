import type { Resource, HealthStatus } from "@homelab-paas/shared-contracts";

import type { IPaasConfig } from "../config/paas-config.ts";
import type { ServiceContainer } from "../docker/types.ts";
import type { IChangeBus } from "../events/change-bus.ts";
import type { IGitService } from "../git/git-service.ts";
import type { IObservationInvalidation } from "../observation/runtime-observations.ts";
import type { DescriptorDecoder } from "../reconciler/types.ts";
import type { IStaticStore } from "../static/static-store.ts";
import type { PeriodicTask } from "../task/periodic.ts";
import type { HttpProbe } from "../util/healthcheck.ts";
import { createLogger } from "../util/logger.ts";
import type { HealthContainerInspection, HealthDocker, HealthObservation } from "./types.ts";

export interface IResourceHealthReader {
	/** Returns latest health only for the same observed container identities and states. */
	getStatus(serviceId: string, resourceId: string, containers: readonly ServiceContainer[]): HealthStatus;
	/** Refines an assessment with inspection; preserves Progressing and extant Unknown resources. */
	refineStatus(health: HealthStatus, containers: readonly HealthContainerInspection[]): HealthStatus;
}

export interface IResourceHealthProgress {
	started(serviceId: string, resourceId: string): void;
	finished(serviceId: string, resourceId: string): void;
}

export interface IResourceHealthTask extends PeriodicTask {
	refresh(serviceId: string): Promise<void>;
}

export interface IResourceHealthRefresh extends IResourceHealthTask {
	/** Immediately discards prior health and pending probes for a lifecycle invalidation. */
	invalidateService(serviceId: string): void;
}

/** Live health is independent of reconciliation backoff and is not persisted across process restarts. */
export class ResourceHealthService implements IResourceHealthReader, IResourceHealthProgress, IResourceHealthRefresh {
	private readonly log = createLogger(ResourceHealthService.name);
	private readonly observations = new Map<string, HealthObservation>();
	private readonly deploying = new Set<string>();
	private readonly generations = new Map<string, symbol>();
	private readonly serviceGenerations = new Map<string, symbol>();

	constructor(
		private readonly config: IPaasConfig,
		private readonly git: IGitService,
		private readonly decode: DescriptorDecoder,
		private readonly docker: HealthDocker,
		private readonly probe: HttpProbe,
		private readonly changes: IChangeBus,
		private readonly runtime?: IObservationInvalidation,
		private readonly staticStore?: { inspect: IStaticStore["inspect"] },
	) {}

	getStatus(serviceId: string, resourceId: string, containers: readonly ServiceContainer[]): HealthStatus {
		const key = `${serviceId}/${resourceId}`;
		if (this.deploying.has(key)) return "Progressing";
		const observation = this.observations.get(key);
		return observation?.signature === this.signature(containers)
			? observation.health
			: containers.length
				? "Unknown"
				: "Missing";
	}

	refineStatus(health: HealthStatus, containers: readonly HealthContainerInspection[]): HealthStatus {
		if (health === "Progressing") return health;
		if (!containers.length || containers.every(({ running }) => running === undefined)) return "Missing";
		if (health === "Unknown") return health;
		return containers.some(({ running }) => !running) ? "Degraded" : health;
	}

	started(serviceId: string, resourceId: string): void {
		const key = `${serviceId}/${resourceId}`;
		if (this.deploying.has(key)) return;
		this.deploying.add(key);
		this.invalidate(key);
		this.serviceGenerations.set(serviceId, Symbol());
		this.runtime?.invalidate(serviceId);
		this.changes.publish({ serviceId });
	}

	finished(serviceId: string, resourceId: string): void {
		const key = `${serviceId}/${resourceId}`;
		this.deploying.delete(key);
		this.invalidate(key);
		this.serviceGenerations.set(serviceId, Symbol());
		this.runtime?.invalidate(serviceId);
		this.changes.publish({ serviceId });
	}

	refresh(serviceId: string): Promise<void> {
		return this.run(serviceId);
	}

	invalidateService(serviceId: string): void {
		this.serviceGenerations.set(serviceId, Symbol());
		this.runtime?.invalidate(serviceId);
		let changed = false;
		for (const key of this.observations.keys()) {
			if (key.startsWith(`${serviceId}/`)) {
				this.invalidate(key);
				changed = true;
			}
		}
		if (changed) this.changes.publish({ serviceId });
	}

	async run(onlyServiceId?: string): Promise<void> {
		const services = this.config.getServices();
		for (const key of this.observations.keys()) {
			if (!Object.hasOwn(services, key.split("/")[0]!)) this.observations.delete(key);
		}
		await Promise.all(
			Object.entries(services)
				.filter(([id]) => onlyServiceId === undefined || id === onlyServiceId)
				.map(async ([serviceId, source]) => {
					const serviceGeneration = Symbol();
					this.serviceGenerations.set(serviceId, serviceGeneration);
					this.runtime?.invalidate(serviceId);
					try {
						const [file, containers] = await Promise.all([
							this.git.fetchFile(serviceId, source),
							this.docker.listServiceContainers(serviceId),
						]);
						if (this.serviceGenerations.get(serviceId) !== serviceGeneration) return;
						const resources = this.decode(file.content, serviceId, file.revision).resources;
						const ids = new Set([
							...Object.keys(resources),
							...containers.map(({ resourceId }) => resourceId),
						]);
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
									const resource = resources[resourceId];
									if (resource?.type === "static") {
										const snapshot = await this.staticStore?.inspect({
											serviceId,
											resourceId,
											revision: file.revision,
											path: resource.path,
										});
										health =
											snapshot === "current"
												? "Healthy"
												: snapshot === "missing"
													? "Missing"
													: snapshot === "different"
														? "Degraded"
														: "Unknown";
									} else health = await this.check(serviceId, resource, current);
								} catch (err) {
									this.log.error({ err, serviceId, resourceId }, "Cannot inspect resource health");
									health = "Unknown";
								}
								if (
									this.generations.get(key) !== generation
									|| this.serviceGenerations.get(serviceId) !== serviceGeneration
								)
									return;
								const previous = this.observations.get(key);
								this.observations.set(key, { health, signature });
								if (previous?.health !== health || previous.signature !== signature)
									this.changes.publish({ serviceId });
							}),
						);
					} catch (err) {
						if (this.serviceGenerations.get(serviceId) !== serviceGeneration) return;
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
