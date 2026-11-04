import type { HealthStatus, UiService } from "@homelab-paas/shared-contracts";

import { createLogger } from "../util/logger.ts";
import type { IHealthHistoryStore } from "./health-history-store.ts";

export interface IHealthHistoryService {
	/** Records observations and returns an independent enriched snapshot. Write failures retain readable persisted coverage. */
	observe(service: UiService): Promise<UiService>;
	/** Failed inspections break continuity before the next successful observation. */
	interrupt(serviceId: string): void;
}

export class HealthHistoryService implements IHealthHistoryService {
	private readonly log = createLogger(HealthHistoryService.name);
	private readonly observed = new Set<string>();
	constructor(
		private readonly store: IHealthHistoryStore,
		private readonly now: () => number,
	) {}

	async observe(service: UiService): Promise<UiService> {
		const result = structuredClone(service);
		try {
			const statuses: Record<string, HealthStatus> = { $service: service.health };
			for (const resource of service.resources) statuses[resource.resourceId] = resource.health;
			await this.store.record(service.serviceId, statuses, this.now(), !this.observed.has(service.serviceId));
			this.observed.add(service.serviceId);
		} catch (err) {
			this.observed.delete(service.serviceId);
			this.log.error(
				{ err, serviceId: service.serviceId },
				"Cannot update health timeline; current status remains available",
			);
		}
		try {
			const history = await this.store.read(service.serviceId);
			result.healthTimeline = history["$service"];
			for (const resource of result.resources) resource.healthTimeline = history[resource.resourceId];
		} catch (err) {
			this.observed.delete(service.serviceId);
			this.log.error(
				{ err, serviceId: service.serviceId },
				"Cannot read health timeline; current status remains available",
			);
		}
		return result;
	}

	interrupt(serviceId: string): void {
		this.observed.delete(serviceId);
	}
}
