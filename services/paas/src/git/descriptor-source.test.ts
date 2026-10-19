import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, expect, test } from "vitest";

import { DeploymentError } from "../deployment/contracts.ts";
import { GitDescriptorSource } from "./descriptor-source.ts";

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "paas-git-"));
	roots.push(root);
	const repo = join(root, "repo");
	await mkdir(repo);
	const git = async (...args: string[]) => (await exec("git", ["-C", repo, ...args])).stdout.trim();
	await git("init", "-b", "fixture");
	await git("config", "user.name", "Test");
	await git("config", "user.email", "test@example.com");
	await writeFile(join(repo, "demo.sd.yaml"), "committed\n");
	await git("add", ".");
	await git("commit", "-m", "initial");
	return { root, repo, git, client: new GitDescriptorSource(join(root, "state"), 5000) };
}
test("local magic finds the enclosing Git repo and reads HEAD, never uncommitted files", async () => {
	const { repo, git, client } = await fixture();
	await writeFile(join(repo, "demo.sd.yaml"), "uncommitted\n");
	expect(await client.read("demo", { remote: "local", descriptorPath: join(repo, "demo.sd.yaml") })).toEqual({
		revision: await git("rev-parse", "HEAD"),
		content: "committed\n",
	});
	await git("add", ".");
	await git("commit", "-m", "update");
	expect((await client.read("demo", { remote: "local", descriptorPath: join(repo, "demo.sd.yaml") })).content).toBe(
		"uncommitted\n",
	);
});
test("remote mode fetches the configured branch into platform state on every poll", async () => {
	const { repo, git, client } = await fixture();
	const source = { remote: repo, branch: "fixture", descriptorPath: "demo.sd.yaml" };
	expect((await client.read("demo", source)).content).toBe("committed\n");
	await writeFile(join(repo, "demo.sd.yaml"), "updated\n");
	await git("add", ".");
	await git("commit", "-m", "update");
	expect((await client.read("demo", source)).content).toBe("updated\n");
	await expect(client.read("demo", { ...source, branch: "missing" })).rejects.toBeInstanceOf(DeploymentError);
});

test("local mode can read a committed descriptor deleted from the working tree", async () => {
	const { repo, client } = await fixture();
	await rm(join(repo, "demo.sd.yaml"));
	expect((await client.read("demo", { remote: "local", descriptorPath: join(repo, "demo.sd.yaml") })).content).toBe(
		"committed\n",
	);
});
test("Git errors do not expose remote credentials or descriptor contents", async () => {
	const { client, root } = await fixture();
	await expect(
		client.read("demo", { remote: "local", descriptorPath: join(root, "missing.sd.yaml") }),
	).rejects.toThrow("Cannot read service descriptor from Git");
});
