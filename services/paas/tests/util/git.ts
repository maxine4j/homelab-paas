import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { mkdir, mkdtemp, writeFile } from "../../src/util/file.ts";

const execute = promisify(execFile);
export const artifactDirectory = async (prefix: string): Promise<string> => {
	const root = resolve(import.meta.dirname, "../../../../artifacts");
	await mkdir(root, { recursive: true, mode: 0o700 });
	return mkdtemp(join(root, `${prefix}-`));
};

/** Real committed files and a bare remote; updates exercise fetch, not working-tree reads. */
export class TestGit {
	readonly remote: string;
	readonly work: string;
	constructor(directory: string) {
		this.remote = join(directory, "remote.git");
		this.work = join(directory, "work");
	}
	async init(): Promise<void> {
		await mkdir(this.work, { recursive: true });
		await execute("git", ["init", "--bare", this.remote]);
		await this.run(["init", "--initial-branch=main"]);
		await this.run(["config", "user.email", "ci@example.test"]);
		await this.run(["config", "user.name", "CI"]);
		await this.run(["remote", "add", "origin", this.remote]);
	}
	async commit(files: Record<string, string>): Promise<string> {
		for (const [name, content] of Object.entries(files))
			await writeFile(join(this.work, name), content, { mode: 0o600 });
		await this.run(["add", "."]);
		await this.run(["commit", "--allow-empty", "-m", "Test descriptor update"]);
		await this.run(["push", "origin", "main"]);
		return (await this.run(["rev-parse", "HEAD"])).trim();
	}
	private async run(args: string[]): Promise<string> {
		return (await execute("git", ["-C", this.work, ...args], { timeout: 15_000 })).stdout;
	}
}
