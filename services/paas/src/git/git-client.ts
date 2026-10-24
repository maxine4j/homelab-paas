import { basename, dirname, isAbsolute, join, relative } from "node:path";

import type { IGitTransport } from "./git-transport.ts";
import { GitClientError } from "./types.ts";

/** All operations reject with GitClientError; paths refer to repositories on disk. */
export interface IGitClient {
	initRepo(directory: string): Promise<void>;
	fetch(directory: string, remote: string, branch: string): Promise<void>;
	locateFile(path: string): Promise<{ directory: string; path: string }>;
	resolveRevision(directory: string, ref: string): Promise<string>;
	readFile(directory: string, revision: string, path: string): Promise<string>;
}

const commitId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

/** Git commands, filesystem discovery, and infrastructure failure translation. */
export class GitClient implements IGitClient {
	constructor(private readonly transport: IGitTransport) {}
	async initRepo(directory: string): Promise<void> {
		await this.operation(async () => {
			await this.transport.createDirectory(directory);
			await this.transport.execute(directory, ["init", "--bare"]);
		});
	}

	async fetch(directory: string, remote: string, branch: string): Promise<void> {
		await this.operation(() =>
			this.transport.execute(directory, ["fetch", "--depth=1", "--", remote, `refs/heads/${branch}`]),
		);
	}

	locateFile(path: string): Promise<{ directory: string; path: string }> {
		return this.operation(async () => {
			const directory = (await this.transport.execute(dirname(path), ["rev-parse", "--show-toplevel"])).trim();
			if (!isAbsolute(directory)) throw new GitClientError();
			const filePath = relative(directory, join(await this.transport.realPath(dirname(path)), basename(path)));
			if (filePath === ".." || filePath.startsWith("../")) throw new GitClientError();
			return { directory, path: filePath };
		});
	}

	resolveRevision(directory: string, ref: string): Promise<string> {
		return this.operation(async () => {
			const revision = (
				await this.transport.execute(directory, [
					"rev-parse",
					"--verify",
					"--end-of-options",
					`${ref}^{commit}`,
				])
			).trim();
			if (!commitId.test(revision)) throw new GitClientError();
			return revision;
		});
	}

	readFile(directory: string, revision: string, path: string): Promise<string> {
		return this.operation(() => {
			if (!commitId.test(revision)) throw new GitClientError();
			return this.transport.execute(directory, ["show", `${revision}:${path}`]);
		});
	}

	private async operation<T>(run: () => Promise<T>): Promise<T> {
		try {
			return await run();
		} catch (cause) {
			throw new GitClientError({ cause });
		}
	}
}
