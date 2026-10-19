import { execFile } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { promisify } from "node:util";

import { DeploymentError, type DescriptorSource, type GitSource } from "../deployment/contracts.ts";

const execute = promisify(execFile);

export class GitDescriptorSource implements DescriptorSource {
	constructor(
		private readonly directory: string,
		private readonly timeoutMs: number,
	) {}
	private async git(directory: string, ...args: string[]): Promise<string> {
		return (
			await execute("git", ["-c", "safe.directory=*", "-C", directory, ...args], {
				timeout: this.timeoutMs,
				maxBuffer: 1024 * 1024,
				env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" },
			})
		).stdout;
	}
	async read(serviceId: string, source: GitSource): Promise<{ revision: string; content: string }> {
		try {
			let directory: string;
			let path: string;
			let ref: string;
			if (source.remote === "local") {
				directory = (await this.git(dirname(source.descriptorPath), "rev-parse", "--show-toplevel")).trim();
				path = relative(
					directory,
					join(await realpath(dirname(source.descriptorPath)), basename(source.descriptorPath)),
				);
				ref = source.branch ?? "HEAD";
			} else {
				directory = join(this.directory, serviceId);
				await mkdir(directory, { recursive: true });
				await this.git(directory, "init", "--bare");
				await this.git(
					directory,
					"fetch",
					"--depth=1",
					"--",
					source.remote,
					`refs/heads/${source.branch ?? "main"}`,
				);
				path = source.descriptorPath;
				ref = "FETCH_HEAD";
			}
			const revision = (await this.git(directory, "rev-parse", "--verify", `${ref}^{commit}`)).trim();
			return { revision, content: await this.git(directory, "show", `${revision}:${path}`) };
		} catch {
			throw new DeploymentError(
				"Cannot read service descriptor from Git; check repository, branch and committed descriptor path",
			);
		}
	}
}
