import type { IResourceHealthTask } from "../health/resource-health-service.ts";
import type { PeriodicTask } from "../task/periodic.ts";
import type { IUiStateCache } from "./cached-paas-ui-service.ts";

/** Serializes periodic/manual health observations before replacing the shared UI state. */
export class ManagementStateTask implements PeriodicTask {
	private pending: Promise<void> = Promise.resolve();

	constructor(
		private readonly health: IResourceHealthTask,
		private readonly state: IUiStateCache,
	) {}

	run(): Promise<void> {
		return this.observe();
	}

	refresh(serviceId: string): Promise<void> {
		return this.observe(serviceId);
	}

	private observe(serviceId?: string): Promise<void> {
		const pending = this.pending.then(async () => {
			try {
				if (serviceId === undefined) await this.health.run();
				else await this.health.refresh(serviceId);
			} finally {
				if (serviceId === undefined) await this.state.refresh();
				else await this.state.refresh(serviceId);
			}
		});
		this.pending = pending.catch(() => {});
		return pending;
	}
}
