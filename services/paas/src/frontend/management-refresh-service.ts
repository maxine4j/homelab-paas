import type { IGitRefreshService } from "../git/git-refresh-service.ts";
import type { GitRefreshResult } from "../git/types.ts";
import type { PeriodicTask } from "../task/periodic.ts";

/** Shared periodic/manual refresh flow: fetch and reconcile, then replace management state. */
export class ManagementRefreshService implements IGitRefreshService {
	constructor(
		private readonly git: IGitRefreshService,
		private readonly state: PeriodicTask,
	) {}

	async refreshOne(serviceId: string): Promise<void> {
		try {
			await this.git.refreshOne(serviceId);
		} finally {
			await this.state.run();
		}
	}

	async refreshAll(): Promise<GitRefreshResult[]> {
		try {
			return await this.git.refreshAll();
		} finally {
			await this.state.run();
		}
	}
}
