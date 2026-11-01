import type { IChangeBus } from "../events/change-bus.ts";
import type { IResourceHealthProgress } from "../health/resource-health-service.ts";
import { createLogger } from "../util/logger.ts";
import type { IServiceEventStore } from "./service-event-store.ts";
import { serviceEventMessages, type IReconciliationStateStore } from "./types.ts";

export interface IDeploymentProgress {
	started(serviceId: string, resourceId: string, revision: string): Promise<void>;
	succeeded(serviceId: string, resourceId: string, revision: string): Promise<void>;
	failed(serviceId: string, resourceId: string, revision: string): Promise<void>;
}

/** Emits resource rollout markers; reconciliation separately owns service-wide revision events. */
export class DeploymentProgress implements IDeploymentProgress {
	private readonly log = createLogger(DeploymentProgress.name);
	private readonly rollouts = new Set<string>();
	constructor(
		private readonly state: IReconciliationStateStore,
		private readonly events: IServiceEventStore,
		private readonly changes: IChangeBus,
		private readonly now: () => number,
		private readonly health?: IResourceHealthProgress,
		private readonly refresh?: (serviceId: string) => Promise<void>,
	) {}
	async started(serviceId: string, resourceId: string, revision: string): Promise<void> {
		this.health?.started(serviceId, resourceId);
		const key = `${serviceId}/${resourceId}/${revision}`;
		if (this.rollouts.has(key)) return;
		const previous = await this.state.read(serviceId);
		if (previous?.activeRevision === revision && previous.phase !== "deploying")
			await this.state.write(serviceId, { ...previous, phase: "deploying", deploymentStartedAt: this.now() });
		this.rollouts.add(key);
		await this.publish(serviceId, resourceId, revision, "deployment.started");
	}
	async succeeded(serviceId: string, resourceId: string, revision: string): Promise<void> {
		this.health?.finished(serviceId, resourceId);
		await this.refreshObservation(serviceId);
		if (!this.rollouts.delete(`${serviceId}/${resourceId}/${revision}`)) return;
		await this.publish(serviceId, resourceId, revision, "deployment.succeeded");
	}
	async failed(serviceId: string, resourceId: string, revision: string): Promise<void> {
		this.health?.finished(serviceId, resourceId);
		await this.refreshObservation(serviceId);
		this.rollouts.delete(`${serviceId}/${resourceId}/${revision}`);
	}
	private async refreshObservation(serviceId: string): Promise<void> {
		try {
			await this.refresh?.(serviceId);
		} catch (err) {
			this.log.error({ err, serviceId }, "Cannot refresh runtime observations after deployment");
		}
	}
	private async publish(
		serviceId: string,
		resourceId: string,
		revision: string,
		event: "deployment.started" | "deployment.succeeded",
	): Promise<void> {
		const value = {
			timestamp: this.now(),
			level: "info" as const,
			event,
			resourceId,
			revision,
			message: event === "deployment.started" ? serviceEventMessages.started : serviceEventMessages.ready,
		};
		this.changes.publish({ serviceId, event: value });
		try {
			await this.events.append(serviceId, value);
		} catch (err) {
			this.log.error({ err, serviceId }, "Cannot persist deployment progress event");
		}
		this.changes.publish({ serviceId });
	}
}
