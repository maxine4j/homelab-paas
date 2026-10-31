import type { PeriodicTask } from "../task/periodic.ts";
import type { IUiStateCache } from "./cached-paas-ui-service.ts";

/** Serializes periodic/manual health observations before replacing the shared UI state. */
export class ManagementStateTask implements PeriodicTask {
	private pending: Promise<void> = Promise.resolve();

	constructor(
		private readonly health: PeriodicTask,
		private readonly state: IUiStateCache,
	) {}

	run(): Promise<void> {
		const pending = this.pending.then(async () => {
			try {
				await this.health.run();
			} finally {
				await this.state.refresh();
			}
		});
		this.pending = pending.catch(() => {});
		return pending;
	}
}
