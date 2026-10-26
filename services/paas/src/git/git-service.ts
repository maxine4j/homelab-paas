import { isAbsolute, join, normalize } from "node:path";

import type { IGitClient } from "./git-client.ts";
import { GitServiceError } from "./types.ts";
import type { GitCommit, GitCredentials, GitFile, GitFileSource } from "./types.ts";

const DEFAULT_GIT_BRANCH = "main";

/** Reads a file from a fixed commit. Calls for the same service must be serialized.
 * Rejects with GitClientError or GitServiceError; no filesystem paths are returned.
 */
export interface IGitService {
	fetchFile(serviceId: string, source: GitFileSource): Promise<GitFile>;
}

export interface IGitRevisionService extends IGitService {
	/** Reads an exact commit, fetching missing remote objects if needed. Rejects with GitClientError or GitServiceError. Serialize with file reads. */
	readCommit(serviceId: string, source: GitFileSource, revision: string): Promise<GitCommit>;
}

/** Committed-file workflows; all filesystem and Git effects go through the client. */
export class GitService implements IGitRevisionService {
	constructor(
		private readonly client: IGitClient,
		private readonly directory: string,
	) {}
	async fetchFile(serviceId: string, source: GitFileSource): Promise<GitFile> {
		this.validateSource(serviceId, source);
		const local = source.remote === "local";

		let file: { directory: string; path: string };
		let ref: string;
		if (local) {
			file = await this.client.locateFile(source.descriptorPath);
			ref = source.branch ?? "HEAD";
		} else {
			file = { directory: join(this.directory, serviceId), path: source.descriptorPath };
			await this.client.initRepo(file.directory);
			await this.client.fetch(
				file.directory,
				source.remote,
				source.branch ?? DEFAULT_GIT_BRANCH,
				...this.credentials(source),
			);
			ref = "FETCH_HEAD";
		}
		const revision = await this.client.resolveRevision(file.directory, ref);
		return { revision, content: await this.client.readFile(file.directory, revision, file.path) };
	}

	async readCommit(serviceId: string, source: GitFileSource, revision: string): Promise<GitCommit> {
		this.validateSource(serviceId, source);
		if (source.remote === "local") {
			const { directory } = await this.client.locateFile(source.descriptorPath);
			return this.client.readCommit(directory, revision);
		}
		const directory = join(this.directory, serviceId);
		await this.client.initRepo(directory);
		try {
			return await this.client.readCommit(directory, revision);
		} catch {
			await this.client.fetchCommit(directory, source.remote, revision, ...this.credentials(source));
			return this.client.readCommit(directory, revision);
		}
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
