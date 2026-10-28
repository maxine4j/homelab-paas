import type { IChangeBus } from "../events/change-bus.ts";
import { createLogger } from "../util/logger.ts";
import type { IServiceEventStore } from "./service-event-store.ts";
import { serviceEventMessages, type IReconciliationStateStore } from "./types.ts";

export interface IDeploymentProgress {
	started(serviceId: string, resourceId: string, revision: string): Promise<void>;
	succeeded(serviceId: string, resourceId: string, revision: string): Promise<void>;
}

/** Adds progress for actual drift rollouts of an already active revision. New revisions are owned by reconciliation. */
export class DeploymentProgress implements IDeploymentProgress {
	private readonly log = createLogger(DeploymentProgress.name);
	private readonly drift = new Set<string>();
	constructor(
		private readonly state: IReconciliationStateStore,
		private readonly events: IServiceEventStore,
		private readonly changes: IChangeBus,
		private readonly now: () => number,
	) {}
	async started(serviceId: string, resourceId: string, revision: string): Promise<void> {
		const previous = await this.state.read(serviceId);
		if (previous?.activeRevision !== revision || previous.phase === "deploying") return;
		await this.state.write(serviceId, { ...previous, phase: "deploying", deploymentStartedAt: this.now() });
		this.drift.add(`${serviceId}/${resourceId}/${revision}`);
		await this.publish(serviceId, resourceId, revision, "deployment.started");
	}
	async succeeded(serviceId: string, resourceId: string, revision: string): Promise<void> {
		if (!this.drift.delete(`${serviceId}/${resourceId}/${revision}`)) return;
		await this.publish(serviceId, resourceId, revision, "deployment.succeeded");
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
