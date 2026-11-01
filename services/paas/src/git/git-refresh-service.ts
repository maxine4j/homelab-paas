import type { IPaasConfig } from "../config/paas-config.ts";
import type { IChangeBus } from "../events/change-bus.ts";
import { createLogger } from "../util/logger.ts";
import type { GitFile, GitFileSource, GitRefreshResult } from "./types.ts";

export interface IGitRefreshCache {
	refreshFile(serviceId: string, source: GitFileSource): Promise<GitFile>;
}

export interface IDesiredReconciliation {
	refreshInputs(serviceId: string): Promise<void>;
	settle(): Promise<void>;
}

export interface IGitRefreshService {
	/** Refreshes one configured source, queues changed inputs and settles eligible work. Throws GitRefreshError. */
	refreshOne(serviceId: string): Promise<void>;
	/** Fetches concurrently, isolates source/service failures and settles changed-input work. Orchestration failures propagate. */
	refreshAll(): Promise<GitRefreshResult[]>;
}

export class GitRefreshError extends Error {
	constructor(
		public readonly kind: "not-found" | "unavailable",
		options?: ErrorOptions,
	) {
		super(
			kind === "not-found"
				? "Service is not configured"
				: "Cannot refresh repository; check Git access and retry",
			options,
		);
	}
}

export class GitRefreshService implements IGitRefreshService {
	private readonly log = createLogger(GitRefreshService.name);
	constructor(
		private readonly config: IPaasConfig,
		private readonly cache: IGitRefreshCache,
		private readonly scheduler: IDesiredReconciliation,
		private readonly changes?: IChangeBus,
	) {}

	async refreshOne(serviceId: string): Promise<void> {
		const sources = this.config.getServices();
		if (!Object.hasOwn(sources, serviceId)) throw new GitRefreshError("not-found");
		const source = sources[serviceId]!;
		try {
			await this.cache.refreshFile(serviceId, source);
			this.changes?.publish({ serviceId, refreshLogs: true });
			await this.scheduler.refreshInputs(serviceId);
			await this.scheduler.settle();
		} catch (cause) {
			throw new GitRefreshError("unavailable", { cause });
		}
	}

	async refreshAll(): Promise<GitRefreshResult[]> {
		const results = await Promise.all(
			Object.entries(this.config.getServices()).map(async ([serviceId, source]) => {
				try {
					await this.cache.refreshFile(serviceId, source);
					this.changes?.publish({ serviceId, refreshLogs: true });
					return { serviceId, refreshed: true };
				} catch (err) {
					this.log.error({ err, serviceId }, "Git refresh failed; retaining the last committed descriptor");
					return { serviceId, refreshed: false };
				}
			}),
		);
		for (const result of results) if (result.refreshed) await this.scheduler.refreshInputs(result.serviceId);
		await this.scheduler.settle();
		return results;
	}
}
