import { tmpdir } from "node:os";
import { join } from "node:path";

import * as files from "@homelab-paas/backend-infrastructure/file";
import { afterEach, expect, test } from "vitest";

import { GitTransport } from "./git-transport.ts";
import { RepositoryClient } from "./repository-client.ts";
import { RepositoryCommitClient } from "./repository-commit-client.ts";

const id = "123e4567-e89b-42d3-a456-426614174000";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const fn of cleanup.splice(0).reverse()) await fn();
});
const setup = async () => {
	const root = await files.mkdtemp(join(tmpdir(), "forge-commits-"));
	cleanup.push(() => files.rm(root, { recursive: true, force: true }));
	const git = new GitTransport();
	cleanup.push(() => git.close());
	const repositories = new RepositoryClient(root, [], files, git);
	await repositories.prepare(id);
	const repo = join(root, "repositories", `${id}.git`);
	const checkout = join(root, "checkout");
	await git.run(["init", "--initial-branch=main", checkout]);
	const run = (args: string[], input?: string) =>
		git.run(["-C", checkout, "-c", "user.name=Owner", "-c", "user.email=owner@example.com", ...args], input);
	const commit = async (message: string, stage = true) => {
		if (stage) await run(["add", "."]);
		await run(["commit", "--allow-empty", "-m", message]);
		const sha = (await run(["rev-parse", "HEAD"])).trim();
		await run(["-c", "protocol.file.allow=always", "push", "--force", repo, "HEAD:refs/heads/test"]);
		return sha;
	};
	return {
		root,
		repo,
		checkout,
		git,
		repositories,
		run,
		commit,
		client: new RepositoryCommitClient(root, git, repositories),
	};
};

test("root and ordinary commits preserve metadata, numbered changes and missing newline without mutating refs or checkout", async () => {
	const { checkout, run, commit, client, git, repo } = await setup();
	await files.writeFile(join(checkout, "space ü [x].txt"), "one\ntwo\n");
	const first = await commit("Initial\n\nBody <script>alert(1)</script>");
	const root = await client.read(id, first);
	expect(root.subject).toBe("Initial");
	expect(root.body).toContain("Body <script>");
	expect(root.author).toBe("Owner");
	expect(root.parents).toEqual([]);
	expect(root.comparisonBase).toBe("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
	expect(root.files.at(0)).toMatchObject({ newPath: "space ü [x].txt", status: "added", additions: 2, deletions: 0 });
	await files.writeFile(join(checkout, "space ü [x].txt"), "one\nthree");
	const second = await commit("Change");
	const refs = await git.run(["-C", repo, "show-ref"]);
	const value = await client.read(id, second);
	expect(value.parents).toEqual([first]);
	expect(value.comparisonBase).toBe(first);
	expect(value.files.at(0)?.hunks.at(0)?.lines).toEqual([
		{ kind: "context", text: "one", oldLine: 1, newLine: 1 },
		{ kind: "deletion", text: "two", oldLine: 2 },
		{ kind: "addition", text: "three", newLine: 2 },
		{ kind: "no-newline", text: "No newline at end of file" },
	]);
	await git.run(["-C", repo, "update-ref", "-d", "refs/heads/test"]);
	expect(await client.read(id, second)).toEqual(value);
	expect(await run(["status", "--porcelain"])).toBe("");
	expect(await files.readFile(join(checkout, "space ü [x].txt"))).toBe("one\nthree");
	expect(refs).toContain(second);
});

test("summarizes renames, deletes, mode changes, binary/non-UTF8, links and submodules safely", async () => {
	const { checkout, run, commit, client } = await setup();
	await files.writeFile(join(checkout, "old.txt"), "unchanged\n");
	await files.writeFile(join(checkout, "deleted"), "gone\n");
	await files.writeFile(join(checkout, "executable"), "echo test\n");
	const first = await commit("Initial");
	await files.rename(join(checkout, "old.txt"), join(checkout, "new.txt"));
	await files.rm(join(checkout, "deleted"));
	await files.chmod(join(checkout, "executable"), 0o755);
	await files.writeFile(join(checkout, "binary"), new Uint8Array([0, 1, 2]));
	await files.writeFile(join(checkout, "nonutf8"), new Uint8Array([255, 254]));
	await files.writeFile(join(checkout, "tab\tname"), "unsupported\n");
	await files.symlink("/outside/never-read", join(checkout, "link"));
	await run(["add", "."]);
	await run(["update-index", "--add", "--cacheinfo", `160000,${first},module`]);
	const value = await client.read(id, await commit("Kinds", false));
	expect(value.files.find((f) => f.newPath === "new.txt")).toMatchObject({
		status: "renamed",
		oldPath: "old.txt",
		additions: 0,
		deletions: 0,
	});
	expect(value.files.find((f) => f.oldPath === "deleted")).toMatchObject({ status: "deleted", deletions: 1 });
	expect(value.files.find((f) => f.newPath === "executable")).toMatchObject({
		oldMode: "100644",
		newMode: "100755",
		additions: 0,
		hunks: [],
	});
	for (const path of ["binary", "nonutf8"])
		expect(value.files.find((f) => f.newPath === path)).toMatchObject({ binary: true, hunks: [] });
	for (const path of ["link", "module", "tab\tname"])
		expect(value.files.find((f) => f.newPath === path)).toMatchObject({ unsupported: true, hunks: [] });
});

test("empty and merge commits use first-parent semantics and retain every parent", async () => {
	const { checkout, run, commit, client } = await setup();
	await files.writeFile(join(checkout, "base"), "base\n");
	const first = await commit("Base");
	const empty = await commit("Empty");
	expect((await client.read(id, empty)).files).toEqual([]);
	await run(["switch", "-c", "side", first]);
	await files.writeFile(join(checkout, "side"), "side\n");
	const side = await commit("Side");
	await run(["switch", "main"]);
	await run(["merge", "--no-ff", "side", "-m", "Merge"]);
	const merge = await commit("After merge");
	const mergeSha = (await run(["rev-parse", `${merge}^`])).trim();
	const value = await client.read(id, mergeSha);
	expect(value.parents).toEqual([empty, side]);
	expect(value.comparisonBase).toBe(empty);
	expect(value.files.map((f) => f.newPath)).toEqual(["side"]);
});

test("invalid, missing and non-commit objects differ from infrastructure failures", async () => {
	const { run, commit, client, root, repositories } = await setup();
	const sha = await commit("Empty");
	await expect(client.read(id, "main")).rejects.toMatchObject({ code: "invalid-request" });
	await expect(client.read("../bad", sha)).rejects.toMatchObject({ code: "invalid-request" });
	await expect(client.read(id, "f".repeat(40))).rejects.toMatchObject({ code: "commit-not-found" });
	const tree = (await run(["rev-parse", "HEAD^{tree}"])).trim();
	await expect(client.read(id, tree)).rejects.toMatchObject({ code: "commit-not-found" });
	const unavailable = new RepositoryCommitClient(
		root,
		{
			run: async () => {
				throw new Error("private diagnostic");
			},
			runBytes: async () => {
				throw new Error("private diagnostic");
			},
		},
		repositories,
	);
	await expect(unavailable.read(id, sha)).rejects.toMatchObject({
		code: "workspace-unavailable",
		message: "workspace-unavailable",
	});
});

test("file, line and byte limits are explicit and never report omitted changes as empty", async () => {
	const { checkout, commit, client } = await setup();
	await files.writeFile(join(checkout, "big"), "x".repeat(300000));
	await files.writeFile(join(checkout, "lines"), "line\n".repeat(2000));
	for (let i = 0; i < 101; i++) await files.writeFile(join(checkout, `z${i}`), "z\n");
	const value = await client.read(id, await commit("Large"));
	expect(value.files).toHaveLength(100);
	expect(value.omittedFiles).toBe(3);
	expect(value.totalsComplete).toBe(false);
	expect(value.files.find((f) => f.newPath === "big")).toMatchObject({ truncated: true, hunks: [] });
	expect(value.files.find((f) => f.newPath === "lines")?.truncated).toBe(true);
	expect(value.files.flatMap((f) => f.hunks.flatMap((h) => h.lines)).length).toBeLessThanOrEqual(1000);
	expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThanOrEqual(1048576);
});

test("JSON escaping and long metadata remain bounded with explicit omissions", async () => {
	const { checkout, commit, client } = await setup();
	for (let i = 0; i < 3; i++) await files.writeFile(join(checkout, `control-${i}`), "\u0001".repeat(120000));
	const value = await client.read(id, await commit(`Subject\n\n${"body".repeat(10000)}`));
	expect(value.metadataTruncated).toBe(true);
	expect(value.body.length).toBe(32768);
	expect(value.omittedFiles).toBeGreaterThan(0);
	expect(value.totalsComplete).toBe(false);
	expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThanOrEqual(1048576);
});

test("non-UTF8 filenames receive an unsupported summary instead of failing the entire commit", async () => {
	const { run, commit, client } = await setup();
	const blob = (await run(["hash-object", "-w", "--stdin"], "safe\n")).trim();
	await run(["update-index", "--index-info"], `100644 ${blob}\t"bad\\377name"\n`);
	const value = await client.read(id, await commit("Unsupported filename", false));
	expect(value.files).toHaveLength(1);
	expect(value.files.at(0)).toMatchObject({ newPath: "bad\ufffdname", unsupported: true, hunks: [] });
});
