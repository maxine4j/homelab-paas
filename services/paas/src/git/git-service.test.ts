import { expect, test, vi } from "vitest";

import type { IGitClient } from "./git-client.ts";
import { GitService } from "./git-service.ts";
import { GitClientError, GitServiceError } from "./types.ts";

test("credentials reach both descriptor and missing commit fetches", async () => {
	const { client, service } = fixture();
	for (const credentials of [{ accessToken: "token" }, { privateKeyPath: "/keys/repo" }]) {
		const source = {
			remote: credentials.accessToken ? "https://example.com/repo" : "git@example.com:repo",
			descriptorPath: "file.yaml",
			...credentials,
		};
		await service.fetchFile("demo", source);
		expect(client.fetch).toHaveBeenLastCalledWith("/state/git/demo", source.remote, "main", credentials);
		client.readCommit.mockRejectedValueOnce(new GitClientError());
		await service.readCommit("demo", source, "a".repeat(40));
		expect(client.fetchCommit).toHaveBeenLastCalledWith(
			"/state/git/demo",
			source.remote,
			"a".repeat(40),
			credentials,
		);
	}
});

function fixture() {
	const client = {
		initRepo: vi.fn<IGitClient["initRepo"]>().mockResolvedValue(undefined),
		fetch: vi.fn<IGitClient["fetch"]>().mockResolvedValue(undefined),
		locateFile: vi
			.fn<IGitClient["locateFile"]>()
			.mockResolvedValue({ directory: "/repo", path: "nested/file.yaml" }),
		resolveRevision: vi.fn<IGitClient["resolveRevision"]>().mockResolvedValue("revision"),
		readFile: vi.fn<IGitClient["readFile"]>().mockResolvedValue("committed\n"),
		readCommit: vi
			.fn<IGitClient["readCommit"]>()
			.mockResolvedValue({ authorName: "Alex", authoredAt: "2026-10-26T00:00:00Z", message: "Deploy" }),
		fetchCommit: vi.fn<IGitClient["fetchCommit"]>().mockResolvedValue(undefined),
	} satisfies IGitClient;
	return { client, service: new GitService(client, "/state/git") };
}

test("commit metadata reads the requested revision and fetches it if absent from the shallow cache", async () => {
	const { client, service } = fixture();
	const source = { remote: "https://example.com/repo.git", descriptorPath: "file.yaml" };
	const revision = "a".repeat(40);
	client.readCommit.mockRejectedValueOnce(new GitClientError());
	expect(await service.readCommit("demo", source, revision)).toEqual({
		authorName: "Alex",
		authoredAt: "2026-10-26T00:00:00Z",
		message: "Deploy",
	});
	expect(client.fetchCommit).toHaveBeenCalledWith("/state/git/demo", source.remote, revision);
	expect(client.readCommit).toHaveBeenLastCalledWith("/state/git/demo", revision);
	client.fetchCommit.mockClear();
	await service.readCommit("demo", source, revision);
	expect(client.fetchCommit).not.toHaveBeenCalled();
});

test("local commit metadata uses the repository without fetching and propagates unavailable commits", async () => {
	const { client, service } = fixture();
	const source = { remote: "local", descriptorPath: "/repo/nested/file.yaml" };
	await service.readCommit("demo", source, "a".repeat(40));
	expect(client.readCommit).toHaveBeenCalledWith("/repo", "a".repeat(40));
	expect(client.initRepo).not.toHaveBeenCalled();
	expect(client.fetchCommit).not.toHaveBeenCalled();
	client.readCommit.mockRejectedValue(new GitClientError());
	await expect(service.readCommit("demo", source, "a".repeat(40))).rejects.toBeInstanceOf(GitClientError);
	expect(client.fetchCommit).not.toHaveBeenCalled();
	await expect(service.readCommit("../escape", source, "a".repeat(40))).rejects.toBeInstanceOf(GitServiceError);
});

test("remote reads initialize, fetch and resolve the branch before reading a fixed commit", async () => {
	const { client, service } = fixture();
	const source = { remote: "https://example.com/repo.git", descriptorPath: "file.yaml" };
	expect(await service.fetchFile("demo", source)).toEqual({ revision: "revision", content: "committed\n" });
	expect(client.initRepo).toHaveBeenCalledWith("/state/git/demo");
	expect(client.fetch).toHaveBeenCalledWith("/state/git/demo", source.remote, "main");
	expect(client.resolveRevision).toHaveBeenCalledWith("/state/git/demo", "FETCH_HEAD");
	expect(client.readFile).toHaveBeenCalledWith("/state/git/demo", "revision", "file.yaml");
	expect(client.initRepo.mock.invocationCallOrder.at(0)).toBeLessThan(client.fetch.mock.invocationCallOrder.at(0)!);
	expect(client.fetch.mock.invocationCallOrder.at(0)).toBeLessThan(
		client.resolveRevision.mock.invocationCallOrder.at(0)!,
	);
	expect(client.resolveRevision.mock.invocationCallOrder.at(0)).toBeLessThan(
		client.readFile.mock.invocationCallOrder.at(0)!,
	);
	await service.fetchFile("demo", { ...source, branch: "release" });
	expect(client.fetch).toHaveBeenLastCalledWith("/state/git/demo", source.remote, "release");
	expect(client.fetch).toHaveBeenCalledTimes(2);
});

test.each([undefined, "release"])(
	"local reads select %s without fetching or initializing repositories",
	async (branch) => {
		const { client, service } = fixture();
		expect(
			await service.fetchFile("demo", { remote: "local", branch, descriptorPath: "/repo/nested/file.yaml" }),
		).toEqual({ revision: "revision", content: "committed\n" });
		expect(client.locateFile).toHaveBeenCalledWith("/repo/nested/file.yaml");
		expect(client.resolveRevision).toHaveBeenCalledWith("/repo", branch ?? "HEAD");
		expect(client.readFile).toHaveBeenCalledWith("/repo", "revision", "nested/file.yaml");
		expect(client.initRepo).not.toHaveBeenCalled();
		expect(client.fetch).not.toHaveBeenCalled();
	},
);

test.each(["initRepo", "fetch", "resolveRevision", "readFile"] as const)(
	"%s failures stop the workflow and preserve sanitized client errors",
	async (operation) => {
		const { client, service } = fixture();
		const error = new GitClientError();
		client[operation].mockRejectedValue(error);
		await expect(service.fetchFile("demo", { remote: "remote", descriptorPath: "file.yaml" })).rejects.toBe(error);
		if (operation !== "readFile") expect(client.readFile).not.toHaveBeenCalled();
	},
);

test.each(["", "..", "../escape", "/absolute", "nested/service"])(
	"rejects unsafe service identity %s before I/O",
	async (serviceId) => {
		const { client, service } = fixture();
		await expect(
			service.fetchFile(serviceId, { remote: "remote", descriptorPath: "file.yaml" }),
		).rejects.toBeInstanceOf(GitServiceError);
		expect(client.initRepo).not.toHaveBeenCalled();
	},
);

test.each([
	{ remote: "local", descriptorPath: "relative.yaml" },
	{ remote: "remote", descriptorPath: "/absolute.yaml" },
	{ remote: "remote", descriptorPath: "../escape.yaml" },
	{ remote: "remote", descriptorPath: "" },
])("rejects invalid source paths before I/O: %j", async (source) => {
	const { client, service } = fixture();
	await expect(service.fetchFile("demo", source)).rejects.toBeInstanceOf(GitServiceError);
	expect(client.initRepo).not.toHaveBeenCalled();
	expect(client.locateFile).not.toHaveBeenCalled();
});
