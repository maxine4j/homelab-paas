import type { IPaasConfig } from "../config/paas-config.ts";
import type { IChangeBus } from "../events/change-bus.ts";
import type { IReconcilerService } from "../reconciler/types.ts";
import { createLogger } from "../util/logger.ts";
import type { GitFile, GitFileSource, GitRefreshResult } from "./types.ts";

export interface IGitRefreshCache {
	refreshFile(serviceId: string, source: GitFileSource): Promise<GitFile>;
}

export interface IGitRefreshService {
	/** Refreshes one configured source, then reconciles from cache. Throws GitRefreshError. */
	refreshOne(serviceId: string): Promise<void>;
	/** Fetches concurrently with per-service isolation, then reconciles from cache. Reconciliation failures propagate. */
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
		private readonly reconciler: IReconcilerService,
		private readonly changes?: IChangeBus,
	) {}

	async refreshOne(serviceId: string): Promise<void> {
		const sources = this.config.getServices();
		if (!Object.hasOwn(sources, serviceId)) throw new GitRefreshError("not-found");
		const source = sources[serviceId]!;
		try {
			await this.cache.refreshFile(serviceId, source);
			this.changes?.publish({ serviceId, refreshLogs: true });
			await this.reconciler.reconcile();
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
		await this.reconciler.reconcile();
		return results;
	}
}
