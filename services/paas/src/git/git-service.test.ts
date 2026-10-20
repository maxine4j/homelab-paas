import { expect, test, vi } from "vitest";

import type { IGitClient } from "./git-client.ts";
import { GitService } from "./git-service.ts";
import { GitClientError, GitServiceError } from "./types.ts";

function fixture() {
	const client = {
		initRepo: vi.fn<IGitClient["initRepo"]>().mockResolvedValue(undefined),
		fetch: vi.fn<IGitClient["fetch"]>().mockResolvedValue(undefined),
		locateFile: vi
			.fn<IGitClient["locateFile"]>()
			.mockResolvedValue({ directory: "/repo", path: "nested/file.yaml" }),
		resolveRevision: vi.fn<IGitClient["resolveRevision"]>().mockResolvedValue("revision"),
		readFile: vi.fn<IGitClient["readFile"]>().mockResolvedValue("committed\n"),
	} satisfies IGitClient;
	return { client, service: new GitService(client, "/state/git") };
}

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
