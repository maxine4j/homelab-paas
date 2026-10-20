import { expect, test, vi } from "vitest";

import { GitClient } from "./git-client.ts";
import type { IGitTransport } from "./git-transport.ts";
import { GitClientError } from "./types.ts";

const revision = "a".repeat(40);
function fixture() {
	const transport = {
		execute: vi.fn<IGitTransport["execute"]>().mockResolvedValue(""),
		createDirectory: vi.fn<IGitTransport["createDirectory"]>().mockResolvedValue(undefined),
		realPath: vi.fn<IGitTransport["realPath"]>().mockResolvedValue("/repo/nested"),
	} satisfies IGitTransport;
	return { transport, client: new GitClient(transport) };
}

test("initializes a reusable bare repository and fetches only the requested branch", async () => {
	const { client, transport } = fixture();
	await client.initRepo("/cache/demo");
	expect(transport.createDirectory).toHaveBeenCalledWith("/cache/demo");
	expect(transport.execute).toHaveBeenCalledWith("/cache/demo", ["init", "--bare"]);
	await client.fetch("/cache/demo", "remote", "release");
	expect(transport.execute).toHaveBeenLastCalledWith("/cache/demo", [
		"fetch",
		"--depth=1",
		"--",
		"remote",
		"refs/heads/release",
	]);
});

test("discovers the repository using the parent directory, so a missing working file is readable", async () => {
	const { client, transport } = fixture();
	transport.execute.mockResolvedValue("/repo\n");
	expect(await client.locateFile("/mount/nested/file.yaml")).toEqual({
		directory: "/repo",
		path: "nested/file.yaml",
	});
	expect(transport.execute).toHaveBeenCalledWith("/mount/nested", ["rev-parse", "--show-toplevel"]);
	expect(transport.realPath).toHaveBeenCalledWith("/mount/nested");
});

test("resolves refs to validated commit IDs and reads exact file contents", async () => {
	const { client, transport } = fixture();
	transport.execute.mockResolvedValueOnce(`${revision}\n`).mockResolvedValueOnce("content\n\n");
	expect(await client.resolveRevision("/repo", "HEAD")).toBe(revision);
	expect(transport.execute).toHaveBeenCalledWith("/repo", [
		"rev-parse",
		"--verify",
		"--end-of-options",
		"HEAD^{commit}",
	]);
	expect(await client.readFile("/repo", revision, "file.yaml")).toBe("content\n\n");
	expect(transport.execute).toHaveBeenLastCalledWith("/repo", ["show", `${revision}:file.yaml`]);
});

test.each(["", "HEAD", "secret credential", "a".repeat(39)])("rejects invalid commit responses %s", async (output) => {
	const { client, transport } = fixture();
	transport.execute.mockResolvedValue(output);
	await expect(client.resolveRevision("/repo", "HEAD")).rejects.toBeInstanceOf(GitClientError);
});

test.each(["initRepo", "fetch", "locateFile", "resolveRevision", "readFile"] as const)(
	"wraps %s command failures without credentials or output",
	async (operation) => {
		const { client, transport } = fixture();
		transport.execute.mockRejectedValue(new Error("https://user:secret@example.com private content"));
		const calls = {
			initRepo: () => client.initRepo("/repo"),
			fetch: () => client.fetch("/repo", "remote", "main"),
			locateFile: () => client.locateFile("/repo/file.yaml"),
			resolveRevision: () => client.resolveRevision("/repo", "HEAD"),
			readFile: () => client.readFile("/repo", revision, "file.yaml"),
		};
		await expect(calls[operation]()).rejects.toEqual(new GitClientError());
	},
);

test("wraps directory creation and canonicalization failures", async () => {
	const { client, transport } = fixture();
	transport.createDirectory.mockRejectedValue(new Error("private directory"));
	await expect(client.initRepo("/repo")).rejects.toEqual(new GitClientError());
	expect(transport.execute).not.toHaveBeenCalled();
	transport.execute.mockResolvedValue("/repo\n");
	transport.realPath.mockRejectedValue(new Error("private path"));
	await expect(client.locateFile("/repo/file.yaml")).rejects.toEqual(new GitClientError());
});

test.each(["", "relative/repo"])("rejects invalid repository roots returned by Git: %s", async (directory) => {
	const { client, transport } = fixture();
	transport.execute.mockResolvedValue(directory);
	await expect(client.locateFile("/repo/file.yaml")).rejects.toEqual(new GitClientError());
});

test("rejects files whose canonical parent escapes the discovered repository", async () => {
	const { client, transport } = fixture();
	transport.execute.mockResolvedValue("/repo\n");
	transport.realPath.mockResolvedValue("/outside");
	await expect(client.locateFile("/repo/link/file.yaml")).rejects.toEqual(new GitClientError());
});

test.each(["HEAD", "--output=/tmp/escape"])(
	"file reads require a resolved commit, rejecting %s before I/O",
	async (ref) => {
		const { client, transport } = fixture();
		await expect(client.readFile("/repo", ref, "file.yaml")).rejects.toEqual(new GitClientError());
		expect(transport.execute).not.toHaveBeenCalled();
	},
);
