import type { IGitRevisionService } from "../git/git-service.ts";
import type { GitCommit, GitFile, GitFileSource } from "../git/types.ts";
import { createLogger } from "../util/logger.ts";

interface CacheEntry<T> {
	value?: T;
	attemptedAt?: number;
	pending?: boolean;
}

interface ServiceCache {
	source: GitFileSource;
	file: CacheEntry<GitFile>;
	commits: Map<string, CacheEntry<GitCommit>>;
}

export interface IPaasUiGitCache {
	/** Returns cached data immediately, or absence during a cold background load.
	 * Refreshes each entry at most once per minute; failures retain stale values.
	 * Source changes invalidate cached values. Background failures are logged.
	 */
	fetchFile(serviceId: string, source: GitFileSource): Promise<GitFile | undefined>;
	readCommit(serviceId: string, source: GitFileSource, revision: string): Promise<GitCommit | undefined>;
}

export class PaasUiGitCache implements IPaasUiGitCache {
	private readonly log = createLogger(PaasUiGitCache.name);
	private readonly services = new Map<string, ServiceCache>();
	private pending: Promise<void> = Promise.resolve();
	constructor(
		private readonly git: IGitRevisionService,
		private readonly now: () => number,
	) {}
	async fetchFile(serviceId: string, source: GitFileSource): Promise<GitFile | undefined> {
		const cache = this.serviceCache(serviceId, source);
		return this.read(cache.file, () => this.git.fetchFile(serviceId, cache.source), serviceId);
	}
	async readCommit(serviceId: string, source: GitFileSource, revision: string): Promise<GitCommit | undefined> {
		const cache = this.serviceCache(serviceId, source);
		let entry = cache.commits.get(revision);
		if (!entry) {
			entry = {};
			cache.commits.set(revision, entry);
		}
		return this.read(entry, () => this.git.readCommit(serviceId, cache.source, revision), serviceId, revision);
	}

	private serviceCache(serviceId: string, source: GitFileSource): ServiceCache {
		let cache = this.services.get(serviceId);
		if (!cache || !this.sameSource(cache.source, source)) {
			cache = { source: { ...source }, file: {}, commits: new Map() };
			this.services.set(serviceId, cache);
		}
		return cache;
	}

	private sameSource(a: GitFileSource, b: GitFileSource): boolean {
		return (
			a.remote === b.remote
			&& a.branch === b.branch
			&& a.descriptorPath === b.descriptorPath
			&& a.accessToken === b.accessToken
			&& a.privateKeyPath === b.privateKeyPath
		);
	}

	private read<T>(entry: CacheEntry<T>, load: () => Promise<T>, serviceId: string, revision?: string): T | undefined {
		if (!entry.pending && (entry.attemptedAt === undefined || this.now() - entry.attemptedAt >= 60_000)) {
			entry.pending = true;
			// Serialize background Git work to protect the shared FETCH_HEAD, never API responses.
			this.pending = this.pending.then(async () => {
				entry.attemptedAt = this.now();
				try {
					entry.value = await load();
				} catch (err) {
					this.log.error({ err, serviceId, revision }, "Cannot refresh management UI Git cache");
				} finally {
					entry.pending = false;
				}
			});
		}
		return entry.value;
	}
}
