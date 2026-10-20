import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, expect, test } from "vitest";

import { GitClient } from "./git-client.ts";
import { GitService } from "./git-service.ts";
import { NodeGitTransport } from "./git-transport.ts";
import { GitClientError } from "./types.ts";

const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "paas-git-layers-"));
	roots.push(root);
	const repo = join(root, "repo");
	await mkdir(repo);
	const git = async (...args: string[]) => (await execute("git", ["-C", repo, ...args])).stdout.trim();
	await git("init", "-b", "main");
	await git("config", "user.name", "Test");
	await git("config", "user.email", "test@example.com");
	await mkdir(join(repo, "nested"));
	await writeFile(join(repo, "nested/file.yaml"), "committed\n");
	await git("add", ".");
	await git("commit", "-m", "initial");
	const transport = new NodeGitTransport(5000, process.env);
	const client = new GitClient(transport);
	return { root, repo, git, transport, client, service: new GitService(client, join(root, "cache")) };
}

test("Node transport creates directories, resolves symlinks and preserves Git output", async () => {
	const { root, repo, transport } = await fixture();
	const directory = join(root, "parent/child");
	await transport.createDirectory(directory);
	await writeFile(join(directory, "file"), "created");
	expect(await readFile(join(directory, "file"), "utf8")).toBe("created");
	await symlink(repo, join(root, "linked"));
	expect(await transport.realPath(join(root, "linked"))).toBe(await transport.realPath(repo));
	expect(await transport.execute(repo, ["show", "HEAD:nested/file.yaml"])).toBe("committed\n");
});

test("remote workflows reuse their bare repository and fetch defaults, updates and explicit branches", async () => {
	const { root, repo, git, service } = await fixture();
	const source = { remote: repo, descriptorPath: "nested/file.yaml" };
	const initial = await git("rev-parse", "HEAD");
	expect(await service.fetchFile("demo", source)).toEqual({ revision: initial, content: "committed\n" });
	await git("branch", "release");
	await writeFile(join(repo, "nested/file.yaml"), "updated\n");
	await git("commit", "-am", "update");
	expect(await service.fetchFile("demo", source)).toEqual({
		revision: await git("rev-parse", "HEAD"),
		content: "updated\n",
	});
	expect(await service.fetchFile("demo", { ...source, branch: "release" })).toEqual({
		revision: initial,
		content: "committed\n",
	});
	expect(
		(await execute("git", ["-C", join(root, "cache/demo"), "rev-parse", "--is-bare-repository"])).stdout.trim(),
	).toBe("true");
	await expect(service.fetchFile("demo", { ...source, branch: "missing" })).rejects.toBeInstanceOf(GitClientError);
	await expect(service.fetchFile("demo", { ...source, descriptorPath: "missing.yaml" })).rejects.toBeInstanceOf(
		GitClientError,
	);
});

test("local workflows use HEAD or an explicit ref and ignore modified and deleted working files through a symlink", async () => {
	const { root, repo, git, service } = await fixture();
	const initial = await git("rev-parse", "HEAD");
	await git("branch", "release");
	await symlink(repo, join(root, "linked"));
	const source = { remote: "local", descriptorPath: join(root, "linked/nested/file.yaml") };
	await writeFile(join(repo, "nested/file.yaml"), "updated\n");
	expect(await service.fetchFile("demo", source)).toEqual({ revision: initial, content: "committed\n" });
	await git("commit", "-am", "update");
	expect((await service.fetchFile("demo", source)).content).toBe("updated\n");
	await rm(join(repo, "nested/file.yaml"));
	expect((await service.fetchFile("demo", source)).content).toBe("updated\n");
	expect(await service.fetchFile("demo", { ...source, branch: "release" })).toEqual({
		revision: initial,
		content: "committed\n",
	});
});

test("Node transport uses the injected environment without mutating it and disables prompting and system configuration", async () => {
	const { root, repo } = await fixture();
	const systemConfig = join(root, "system.config");
	await writeFile(systemConfig, "[paas]\n\tmarker = system\n");
	const environment = {
		...process.env,
		GIT_TERMINAL_PROMPT: "1",
		GIT_CONFIG_NOSYSTEM: "0",
		GIT_CONFIG_SYSTEM: systemConfig,
	};
	const transport = new NodeGitTransport(5000, environment);
	const output = await transport.execute(repo, [
		"-c",
		"alias.environment=!printenv GIT_TERMINAL_PROMPT",
		"environment",
	]);
	expect(output).toBe("0\n");
	await expect(transport.execute(repo, ["config", "--get", "paas.marker"])).rejects.toThrow();
	expect(environment.GIT_TERMINAL_PROMPT).toBe("1");
	expect(environment.GIT_CONFIG_NOSYSTEM).toBe("0");
});

test("Node transport bounds command duration and output; client sanitizes those failures", async () => {
	const { repo, git, service } = await fixture();
	const transport = new NodeGitTransport(20, process.env);
	await expect(transport.execute(repo, ["-c", "alias.wait=!sleep 1", "wait"])).rejects.toMatchObject({
		killed: true,
	});
	await writeFile(join(repo, "nested/file.yaml"), "x".repeat(1024 * 1024 + 1));
	await git("commit", "-am", "oversized");
	await expect(
		new NodeGitTransport(5000, process.env).execute(repo, ["show", "HEAD:nested/file.yaml"]),
	).rejects.toMatchObject({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" });
	await expect(
		service.fetchFile("demo", { remote: "local", descriptorPath: join(repo, "nested/file.yaml") }),
	).rejects.toEqual(new GitClientError());
});
