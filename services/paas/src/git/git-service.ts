import { createHash } from "node:crypto";
import { isAbsolute, join, normalize } from "node:path";

import { createLogger } from "../util/logger.ts";
import type { IGitClient } from "./git-client.ts";
import { GitServiceError } from "./types.ts";
import type { GitCommit, GitCredentials, GitFile, GitFileSource } from "./types.ts";

const DEFAULT_GIT_BRANCH = "main";

/** Reads cached committed files. Memory misses await disk and schedule remote refresh.
 * Rejects with GitClientError or GitServiceError; no filesystem paths are returned.
 */
export interface IGitService {
	fetchFile(serviceId: string, source: GitFileSource): Promise<GitFile>;
}

export interface IGitRevisionService extends IGitService {
	/** Reads immutable disk objects without waiting for remote refresh. Missing objects fetch once per refresh cycle. Rejects with GitClientError or GitServiceError. */
	readCommit(serviceId: string, source: GitFileSource, revision: string): Promise<GitCommit>;
}

export interface IGitCacheService extends IGitRevisionService {
	/** Fetches and publishes a committed descriptor. Concurrent refreshes deduplicate; failure retains the last good file. */
	refreshFile(serviceId: string, source: GitFileSource): Promise<GitFile>;
}

/** Committed-file workflows; all filesystem and Git effects go through the client. */
export class GitService implements IGitCacheService {
	private readonly files = new Map<string, GitFile>();
	private readonly commits = new Map<string, GitCommit>();
	private readonly pending = new Map<string, Promise<unknown>>();
	private readonly refreshes = new Map<string, Promise<GitFile>>();
	private readonly failures = new Map<string, unknown>();
	private readonly commitFailures = new Map<string, unknown>();
	private readonly commitLoads = new Map<string, Promise<GitCommit>>();
	private readonly sources = new Map<string, string>();
	private readonly log = createLogger(GitService.name);
	constructor(
		private readonly client: IGitClient,
		private readonly directory: string,
	) {}
	async fetchFile(serviceId: string, source: GitFileSource): Promise<GitFile> {
		this.validateSource(serviceId, source);
		const key = this.key(serviceId, source);
		this.activate(serviceId, key);
		if (source.remote === "local") return this.serialize(serviceId, () => this.readDisk(serviceId, source));
		const cached = this.files.get(key);
		if (cached) return { ...cached };
		if (this.failures.has(key)) throw this.failures.get(key);
		let hydrated = false;
		const result = await this.serialize(serviceId, async () => {
			const current = this.files.get(key);
			if (current) return current;
			try {
				const file = await this.readDisk(serviceId, source);
				hydrated = true;
				this.files.set(key, file);
				return file;
			} catch {
				return undefined;
			}
		});
		if (!result) return this.refreshFile(serviceId, source);
		if (hydrated)
			void this.refreshFile(serviceId, source).catch((err: unknown) =>
				this.log.error({ err, serviceId }, "Git cache refresh failed; retaining the last committed descriptor"),
			);
		return { ...result };
	}

	refreshFile(serviceId: string, source: GitFileSource): Promise<GitFile> {
		this.validateSource(serviceId, source);
		const key = this.key(serviceId, source);
		this.activate(serviceId, key);
		const current = this.refreshes.get(key);
		if (current) return current.then((file) => ({ ...file }));
		const result = this.serialize(serviceId, async () => {
			try {
				const file = await this.loadRemote(serviceId, source);
				this.failures.delete(key);
				for (const commitKey of this.commitFailures.keys())
					if (commitKey.startsWith(`${key}:`)) this.commitFailures.delete(commitKey);
				return file;
			} catch (err) {
				this.failures.set(key, err);
				if (!this.files.has(key)) {
					try {
						this.files.set(key, await this.readDisk(serviceId, source));
					} catch {
						/* No last-known-good descriptor exists. */
					}
				}
				throw err;
			}
		});
		this.refreshes.set(key, result);
		void result.finally(() => this.refreshes.delete(key)).catch(() => {});
		return result.then((file) => ({ ...file }));
	}

	async readCommit(serviceId: string, source: GitFileSource, revision: string): Promise<GitCommit> {
		this.validateSource(serviceId, source);
		this.activate(serviceId, this.key(serviceId, source));
		const key = `${this.key(serviceId, source)}:${revision}`;
		const current = this.commits.get(key);
		if (current) return { ...current };
		if (this.commitFailures.has(key)) throw this.commitFailures.get(key);
		const pending = this.commitLoads.get(key);
		if (pending) return { ...(await pending) };
		const result = this.loadCommit(serviceId, source, revision).then(
			(commit) => {
				this.commits.set(key, commit);
				return commit;
			},
			(err: unknown) => {
				this.commitFailures.set(key, err);
				throw err;
			},
		);
		this.commitLoads.set(key, result);
		void result.finally(() => this.commitLoads.delete(key)).catch(() => {});
		return { ...(await result) };
	}

	private async loadRemote(serviceId: string, source: GitFileSource): Promise<GitFile> {
		if (source.remote !== "local") {
			const directory = this.repositoryDirectory(serviceId, source);
			await this.client.initRepo(directory);
			await this.client.fetch(
				directory,
				source.remote,
				source.branch ?? DEFAULT_GIT_BRANCH,
				...this.credentials(source),
			);
		}
		const file = await this.readDisk(serviceId, source, "FETCH_HEAD");
		if (source.remote !== "local")
			await this.client.publishRevision(this.repositoryDirectory(serviceId, source), file.revision);
		this.files.set(this.key(serviceId, source), file);
		return file;
	}

	private async readDisk(
		serviceId: string,
		source: GitFileSource,
		remoteRef = "refs/paas/descriptor",
	): Promise<GitFile> {
		const local = source.remote === "local";

		let file: { directory: string; path: string };
		let ref: string;
		if (local) {
			file = await this.client.locateFile(source.descriptorPath);
			ref = source.branch ?? "HEAD";
		} else {
			file = { directory: this.repositoryDirectory(serviceId, source), path: source.descriptorPath };
			ref = remoteRef;
		}
		const revision = await this.client.resolveRevision(file.directory, ref);
		return { revision, content: await this.client.readFile(file.directory, revision, file.path) };
	}

	private async loadCommit(serviceId: string, source: GitFileSource, revision: string): Promise<GitCommit> {
		if (source.remote === "local") {
			const { directory } = await this.client.locateFile(source.descriptorPath);
			return this.client.readCommit(directory, revision);
		}
		const directory = this.repositoryDirectory(serviceId, source);
		try {
			return await this.client.readCommit(directory, revision);
		} catch {
			return this.serialize(serviceId, async () => {
				await this.client.initRepo(directory);
				await this.client.fetchCommit(directory, source.remote, revision, ...this.credentials(source));
				return this.client.readCommit(directory, revision);
			});
		}
	}

	private key(serviceId: string, source: GitFileSource): string {
		return `${serviceId}/${createHash("sha256")
			.update(
				JSON.stringify([
					source.remote,
					source.branch ?? (source.remote === "local" ? "HEAD" : DEFAULT_GIT_BRANCH),
					source.descriptorPath,
					source.accessToken,
					source.privateKeyPath,
				]),
			)
			.digest("hex")}`;
	}

	private activate(serviceId: string, key: string): void {
		const previous = this.sources.get(serviceId);
		if (previous && previous !== key) {
			this.files.delete(previous);
			this.failures.delete(previous);
			for (const commitKey of this.commits.keys())
				if (commitKey.startsWith(`${previous}:`)) this.commits.delete(commitKey);
			for (const commitKey of this.commitFailures.keys())
				if (commitKey.startsWith(`${previous}:`)) this.commitFailures.delete(commitKey);
		}
		this.sources.set(serviceId, key);
	}

	private repositoryDirectory(serviceId: string, source: GitFileSource): string {
		return join(this.directory, this.key(serviceId, source));
	}

	private serialize<T>(serviceId: string, run: () => Promise<T>): Promise<T> {
		const result = (this.pending.get(serviceId) ?? Promise.resolve()).catch(() => {}).then(run);
		this.pending.set(serviceId, result);
		void result
			.finally(() => {
				if (this.pending.get(serviceId) === result) this.pending.delete(serviceId);
			})
			.catch(() => {});
		return result;
	}

	private credentials(source: GitFileSource): [] | [GitCredentials] {
		if (source.privateKeyPath) return [{ privateKeyPath: source.privateKeyPath }];
		if (source.accessToken) return [{ accessToken: source.accessToken }];
		return [];
	}

	private validateSource(serviceId: string, source: GitFileSource): void {
		const path = normalize(source.descriptorPath);
		if (
			!/^[a-zA-Z0-9_-]+$/.test(serviceId)
			|| !source.descriptorPath
			|| (source.remote === "local"
				? !isAbsolute(path)
				: isAbsolute(path) || path === ".." || path.startsWith("../"))
		)
			throw new GitServiceError();
	}
}
