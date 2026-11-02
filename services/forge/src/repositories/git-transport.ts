import { execFile } from "node:child_process";

export class GitError extends Error {
	constructor(options?: ErrorOptions) {
		super("Git operation failed", options);
		this.name = "GitError";
	}
}
export interface IGitTransport {
	/** Noninteractive system Git, 120s deadline and 1 MiB output bound; throws GitError. */
	run(arguments_: string[]): Promise<string>;
}
export class GitTransport implements IGitTransport {
	async run(arguments_: string[]): Promise<string> {
		return new Promise((resolve, reject) => {
			execFile(
				"git",
				[
					"-c",
					"protocol.allow=never",
					"-c",
					"protocol.https.allow=always",
					"-c",
					"credential.helper=",
					"-c",
					"core.hooksPath=/dev/null",
					"-c",
					"http.followRedirects=false",
					...arguments_,
				],
				{
					timeout: 120_000,
					maxBuffer: 1024 * 1024,
					encoding: "utf8",
					killSignal: "SIGKILL",
					env: {
						PATH: process.env["PATH"],
						LANG: "C",
						LC_ALL: "C",
						GIT_CONFIG_NOSYSTEM: "1",
						GIT_CONFIG_GLOBAL: "/dev/null",
						GIT_TERMINAL_PROMPT: "0",
						GIT_ASKPASS: "/bin/false",
					},
				},
				(cause, stdout) => {
					if (cause) reject(new GitError({ cause }));
					else resolve(stdout);
				},
			);
		});
	}
}
