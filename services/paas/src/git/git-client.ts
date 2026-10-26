import { basename, dirname, isAbsolute, join, relative } from "node:path";

import type { IGitTransport } from "./git-transport.ts";
import { GitClientError } from "./types.ts";
import type { GitCommit, GitCredentials } from "./types.ts";

/** All operations reject with GitClientError; paths refer to repositories on disk. */
export interface IGitClient {
	initRepo(directory: string): Promise<void>;
	fetch(directory: string, remote: string, branch: string, credentials?: GitCredentials): Promise<void>;
	locateFile(path: string): Promise<{ directory: string; path: string }>;
	resolveRevision(directory: string, ref: string): Promise<string>;
	readFile(directory: string, revision: string, path: string): Promise<string>;
	readCommit(directory: string, revision: string): Promise<GitCommit>;
	fetchCommit(directory: string, remote: string, revision: string, credentials?: GitCredentials): Promise<void>;
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

	async fetch(directory: string, remote: string, branch: string, credentials?: GitCredentials): Promise<void> {
		await this.operation(() =>
			this.transport.execute(
				directory,
				["fetch", "--depth=1", "--", remote, `refs/heads/${branch}`],
				...this.authentication(directory, remote, credentials),
			),
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

	readCommit(directory: string, revision: string): Promise<GitCommit> {
		return this.operation(async () => {
			if (!commitId.test(revision)) throw new GitClientError();
			const output = await this.transport.execute(directory, [
				"show",
				"--no-patch",
				"--format=%an%x00%aI%x00%B",
				revision,
				"--",
			]);
			const [authorName, authoredAt, message, extra] = output.split("\0");
			if (
				authorName === undefined
				|| !authoredAt
				|| !Number.isFinite(Date.parse(authoredAt))
				|| message === undefined
				|| extra !== undefined
			)
				throw new GitClientError();
			return { authorName, authoredAt, message: message.trimEnd() };
		});
	}

	async fetchCommit(
		directory: string,
		remote: string,
		revision: string,
		credentials?: GitCredentials,
	): Promise<void> {
		await this.operation(() => {
			if (!commitId.test(revision)) throw new GitClientError();
			return this.transport.execute(
				directory,
				["fetch", "--depth=1", "--", remote, revision],
				...this.authentication(directory, remote, credentials),
			);
		});
	}

	private authentication(
		directory: string,
		remote: string,
		credentials?: GitCredentials,
	): [] | [Record<string, string>] {
		if (credentials?.accessToken)
			return [
				{
					GIT_CONFIG_COUNT: "2",
					GIT_CONFIG_KEY_0: "credential.helper",
					GIT_CONFIG_VALUE_0: "",
					GIT_CONFIG_KEY_1: `http.${remote}.extraHeader`,
					GIT_CONFIG_VALUE_1: `Authorization: Basic ${Buffer.from(`x-access-token:${credentials.accessToken}`).toString("base64")}`,
				},
			];
		if (/^ssh:\/\//i.test(remote) || (/^(?:[^@/:\s]+@)?[^/:\s]+:.+/.test(remote) && !remote.includes("://"))) {
			const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
			return [
				{
					GIT_SSH_COMMAND: `ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${quote(join(directory, "known_hosts"))}${credentials?.privateKeyPath ? ` -o IdentitiesOnly=yes -i ${quote(credentials.privateKeyPath)}` : ""}`,
				},
			];
		}
		return [];
	}

	private async operation<T>(run: () => Promise<T>): Promise<T> {
		try {
			return await run();
		} catch (cause) {
			throw new GitClientError({ cause });
		}
	}
}
