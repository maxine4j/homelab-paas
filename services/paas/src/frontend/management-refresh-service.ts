import type { IGitRefreshService } from "../git/git-refresh-service.ts";
import type { GitRefreshResult } from "../git/types.ts";
import { ServiceLifecycleError, type IServiceLifecycle } from "../reconciler/reconciler-service.ts";
import type { PeriodicTask } from "../task/periodic.ts";

/** Shared periodic/manual refresh flow: fetch and reconcile, then replace management state. */
export class ManagementRefreshService implements IGitRefreshService, IServiceLifecycle {
	constructor(
		private readonly git: IGitRefreshService,
		private readonly state: PeriodicTask,
		private readonly audit?: { run(serviceId?: string): Promise<void> },
		private readonly scheduler?: { settle(): Promise<void> },
		private readonly lifecycle?: IServiceLifecycle,
	) {}

	async pause(serviceId: string): Promise<void> {
		if (!this.lifecycle) throw new ServiceLifecycleError("unavailable", "pause");
		try {
			await this.lifecycle.pause(serviceId);
		} finally {
			await this.state.run();
		}
	}

	async resume(serviceId: string): Promise<void> {
		if (!this.lifecycle) throw new ServiceLifecycleError("unavailable", "resume");
		try {
			await this.lifecycle.resume(serviceId);
		} finally {
			await this.state.run();
		}
	}

	async refreshOne(serviceId: string): Promise<void> {
		try {
			await this.git.refreshOne(serviceId);
		} finally {
			await this.observe(serviceId);
		}
	}

	async refreshAll(): Promise<GitRefreshResult[]> {
		try {
			return await this.git.refreshAll();
		} finally {
			await this.observe();
		}
	}

	private async observe(serviceId?: string): Promise<void> {
		try {
			await this.audit?.run(serviceId);
			await this.scheduler?.settle();
		} finally {
			await this.state.run();
		}
	}
}
