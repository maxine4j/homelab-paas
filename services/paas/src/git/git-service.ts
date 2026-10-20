import { isAbsolute, join, normalize } from "node:path";

import type { IGitClient } from "./git-client.ts";
import { GitServiceError } from "./types.ts";
import type { GitFile, GitFileSource } from "./types.ts";

const DEFAULT_GIT_BRANCH = "main";

/** Reads a file from a fixed commit. Calls for the same service must be serialized.
 * Rejects with GitClientError or GitServiceError; no filesystem paths are returned.
 */
export interface IGitService {
	fetchFile(serviceId: string, source: GitFileSource): Promise<GitFile>;
}

/** Committed-file workflows; all filesystem and Git effects go through the client. */
export class GitService implements IGitService {
	constructor(
		private readonly client: IGitClient,
		private readonly directory: string,
	) {}
	async fetchFile(serviceId: string, source: GitFileSource): Promise<GitFile> {
		const local = source.remote === "local";
		const path = normalize(source.descriptorPath);
		if (
			!/^[a-zA-Z0-9_-]+$/.test(serviceId)
			|| !source.descriptorPath
			|| (local ? !isAbsolute(path) : isAbsolute(path) || path === ".." || path.startsWith("../"))
		) {
			throw new GitServiceError();
		}

		let file: { directory: string; path: string };
		let ref: string;
		if (local) {
			file = await this.client.locateFile(source.descriptorPath);
			ref = source.branch ?? "HEAD";
		} else {
			file = { directory: join(this.directory, serviceId), path: source.descriptorPath };
			await this.client.initRepo(file.directory);
			await this.client.fetch(file.directory, source.remote, source.branch ?? DEFAULT_GIT_BRANCH);
			ref = "FETCH_HEAD";
		}
		const revision = await this.client.resolveRevision(file.directory, ref);
		return { revision, content: await this.client.readFile(file.directory, revision, file.path) };
	}
}
