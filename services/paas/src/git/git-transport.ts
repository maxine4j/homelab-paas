import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { IPaasConfig } from "../config/paas-config.ts";
import { mkdir, realpath } from "../util/file.ts";

/** Internal infrastructure boundary; failures are translated by GitClient. */
export interface IGitTransport {
	execute(directory: string, args: string[]): Promise<string>;
	createDirectory(directory: string): Promise<void>;
	realPath(path: string): Promise<string>;
}

const execute = promisify(execFile);

/** Node adapter with bounded, noninteractive Git subprocesses. */
export class NodeGitTransport implements IGitTransport {
	constructor(private readonly config: IPaasConfig) {}
	async execute(directory: string, args: string[]): Promise<string> {
		return (
			await execute("git", ["-c", "safe.directory=*", "-C", directory, ...args], {
				timeout: this.config.getGitConfig().operationTimeoutSeconds * 1000,
				maxBuffer: 1024 * 1024,
				env: { ...this.config.getGitEnvironment(), GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" },
			})
		).stdout;
	}

	async createDirectory(directory: string): Promise<void> {
		await mkdir(directory, { recursive: true });
	}

	realPath(path: string): Promise<string> {
		return realpath(path);
	}
}
