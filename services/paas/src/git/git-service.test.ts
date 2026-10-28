import { expect, test, vi } from "vitest";

import type { IGitClient } from "./git-client.ts";
import { GitService } from "./git-service.ts";
import { GitClientError, GitServiceError } from "./types.ts";

const source = { remote: "https://example.com/repo", descriptorPath: "file.yaml" };
const file = { revision: "a".repeat(40), content: "committed\n" };
const fixture = () => {
	const refs = new Map<string, string>();
	const client = {
		initRepo: vi.fn<IGitClient["initRepo"]>().mockResolvedValue(undefined),
		fetch: vi.fn<IGitClient["fetch"]>().mockResolvedValue(undefined),
		locateFile: vi
			.fn<IGitClient["locateFile"]>()
			.mockResolvedValue({ directory: "/repo", path: "nested/file.yaml" }),
		resolveRevision: vi.fn<IGitClient["resolveRevision"]>().mockImplementation(async (directory, ref) => {
			if (ref === "refs/paas/descriptor") {
				const revision = refs.get(directory);
				if (!revision) throw new GitClientError();
				return revision;
			}
			return file.revision;
		}),
		publishRevision: vi.fn<IGitClient["publishRevision"]>().mockImplementation(async (directory, revision) => {
			refs.set(directory, revision);
		}),
		readFile: vi.fn<IGitClient["readFile"]>().mockResolvedValue(file.content),
		readCommit: vi
			.fn<IGitClient["readCommit"]>()
			.mockResolvedValue({ authorName: "Alex", authoredAt: "2026-10-26T00:00:00Z", message: "Deploy" }),
		fetchCommit: vi.fn<IGitClient["fetchCommit"]>().mockResolvedValue(undefined),
	} satisfies IGitClient;
	return { client, refs, service: new GitService(client, "/state/git") };
};

test("cold load populates memory and disk; warm reads do no Git I/O", async () => {
	const { client, service } = fixture();
	expect(await service.fetchFile("demo", source)).toEqual(file);
	expect(client.fetch).toHaveBeenCalledTimes(1);
	expect(client.publishRevision).toHaveBeenCalledWith(
		expect.stringMatching(/^\/state\/git\/demo\/[a-f0-9]{64}$/),
		file.revision,
	);
	client.readFile.mockClear();
	client.resolveRevision.mockClear();
	expect(await service.fetchFile("demo", source)).toEqual(file);
	expect(client.fetch).toHaveBeenCalledTimes(1);
	expect(client.readFile).not.toHaveBeenCalled();
	expect(client.resolveRevision).not.toHaveBeenCalled();
});
test("restart hydrates disk without awaiting the remote refresh", async () => {
	const { client, service } = fixture();
	await service.refreshFile("demo", source);
	client.fetch.mockImplementation(() => new Promise(() => {}));
	expect(await new GitService(client, "/state/git").fetchFile("demo", source)).toEqual(file);
	expect(client.resolveRevision).toHaveBeenCalledWith(expect.any(String), "refs/paas/descriptor");
});
test("restart disk metadata reads do not wait for the background remote refresh", async () => {
	const { client, service } = fixture();
	await service.refreshFile("demo", source);
	let release = () => {};
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	client.fetch.mockReturnValue(blocked);
	const restarted = new GitService(client, "/state/git");
	await restarted.fetchFile("demo", source);
	let read = false;
	const metadata = restarted.readCommit("demo", source, file.revision).then(() => {
		read = true;
	});
	for (let turn = 0; turn < 10; turn++) await Promise.resolve();
	const available = read;
	release();
	await metadata;
	expect(available).toBe(true);
});
test("refresh deduplicates requests, publishes new data and retains good data after failure", async () => {
	const { client, refs, service } = fixture();
	const results = await Promise.all([service.refreshFile("demo", source), service.refreshFile("demo", source)]);
	results[1]!.content = "caller modification";
	expect(await service.fetchFile("demo", source)).toEqual(file);
	expect(client.fetch).toHaveBeenCalledTimes(1);
	client.readFile.mockResolvedValue("new content");
	await service.refreshFile("demo", source);
	expect((await service.fetchFile("demo", source)).content).toBe("new content");
	client.fetch.mockRejectedValue(new GitClientError());
	await expect(service.refreshFile("demo", source)).rejects.toBeInstanceOf(GitClientError);
	expect((await service.fetchFile("demo", source)).content).toBe("new content");
	expect([...refs.values()]).toEqual([file.revision]);
});
test("descriptor read failures never publish a bad branch revision", async () => {
	const { client, service } = fixture();
	await service.refreshFile("demo", source);
	client.publishRevision.mockClear();
	client.readFile.mockRejectedValue(new GitClientError());
	await expect(service.refreshFile("demo", source)).rejects.toBeInstanceOf(GitClientError);
	expect(client.publishRevision).not.toHaveBeenCalled();
	expect(await service.fetchFile("demo", source)).toEqual(file);
});
test("a failed explicit cold refresh does not fetch again on reconciliation reads", async () => {
	const { client, service } = fixture();
	client.fetch.mockRejectedValue(new GitClientError());
	await expect(service.refreshFile("demo", source)).rejects.toBeInstanceOf(GitClientError);
	await expect(service.fetchFile("demo", source)).rejects.toBeInstanceOf(GitClientError);
	expect(client.fetch).toHaveBeenCalledTimes(1);
});
test("cold reads and simultaneous explicit refresh share one remote fetch", async () => {
	const { client, service } = fixture();
	await Promise.all([service.fetchFile("demo", source), service.refreshFile("demo", source)]);
	expect(client.fetch).toHaveBeenCalledTimes(1);
});
test("missing commit fetch failures are cached until the next successful descriptor refresh", async () => {
	const { client, service } = fixture();
	client.readCommit.mockRejectedValue(new GitClientError());
	client.fetchCommit.mockRejectedValue(new GitClientError());
	await expect(service.readCommit("demo", source, file.revision)).rejects.toBeInstanceOf(GitClientError);
	await expect(service.readCommit("demo", source, file.revision)).rejects.toBeInstanceOf(GitClientError);
	expect(client.fetchCommit).toHaveBeenCalledTimes(1);
	await service.refreshFile("demo", source);
	client.readCommit.mockResolvedValue({
		authorName: "Alex",
		authoredAt: "2026-10-26T00:00:00Z",
		message: "Recovered",
	});
	expect((await service.readCommit("demo", source, file.revision)).message).toBe("Recovered");
});
test("warm metadata reads remain available while a remote refresh is blocked", async () => {
	const { client, service } = fixture();
	await service.readCommit("demo", source, file.revision);
	let release = () => {};
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	client.fetch.mockReturnValue(blocked);
	const refreshing = service.refreshFile("demo", source);
	const result = await Promise.race([service.readCommit("demo", source, file.revision), Promise.resolve("blocked")]);
	release();
	await refreshing;
	expect(result).not.toBe("blocked");
});
test("local committed files are observed on each reconciliation read", async () => {
	const { client, service } = fixture();
	const local = { remote: "local", descriptorPath: "/repo/file.yaml" };
	await service.fetchFile("demo", local);
	client.readFile.mockResolvedValue("updated local commit");
	expect((await service.fetchFile("demo", local)).content).toBe("updated local commit");
	expect(client.fetch).not.toHaveBeenCalled();
});
test.each([
	{ remote: "https://example.com/other" },
	{ branch: "release" },
	{ descriptorPath: "other.yaml" },
	{ accessToken: "rotated" },
	{ privateKeyPath: "/keys/rotated" },
])("source changes use a distinct disk namespace: %j", async (change) => {
	const { client, service } = fixture();
	await service.refreshFile("demo", source);
	const oldDirectory = client.fetch.mock.calls.at(0)?.[0];
	client.fetch.mockRejectedValue(new GitClientError());
	await expect(service.fetchFile("demo", { ...source, ...change })).rejects.toBeInstanceOf(GitClientError);
	expect(client.fetch.mock.calls.at(-1)?.[0]).not.toBe(oldDirectory);
});
test("different services refresh concurrently and same-service Git operations serialize", async () => {
	const { client, service } = fixture();
	let release = () => {};
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	client.fetch.mockImplementation(async (directory) => {
		if (directory.includes("/slow/")) await blocked;
	});
	const slow = service.refreshFile("slow", source);
	client.readCommit.mockRejectedValueOnce(new GitClientError());
	const commit = service.readCommit("slow", source, file.revision);
	await service.refreshFile("fast", source);
	expect(client.fetchCommit).not.toHaveBeenCalled();
	release();
	await Promise.all([slow, commit]);
	expect(client.readCommit).toHaveBeenCalledTimes(2);
});
test.each([{ accessToken: "token" }, { privateKeyPath: "/keys/repo" }])(
	"credentials reach branch and exact commit fetches: %j",
	async (credentials) => {
		const { client, service } = fixture();
		const authenticated = { ...source, ...credentials };
		await service.refreshFile("demo", authenticated);
		expect(client.fetch).toHaveBeenCalledWith(expect.any(String), source.remote, "main", credentials);
		client.readCommit.mockRejectedValueOnce(new GitClientError());
		await service.readCommit("demo", authenticated, file.revision);
		expect(client.fetchCommit).toHaveBeenCalledWith(expect.any(String), source.remote, file.revision, credentials);
		client.readCommit.mockClear();
		await service.readCommit("demo", authenticated, file.revision);
		expect(client.readCommit).not.toHaveBeenCalled();
	},
);
test.each([undefined, "release"])("local refresh reads committed %s without remote access", async (branch) => {
	const { client, service } = fixture();
	const local = { remote: "local", descriptorPath: "/repo/nested/file.yaml", branch };
	expect(await service.refreshFile("demo", local)).toEqual(file);
	expect(client.resolveRevision).toHaveBeenCalledWith("/repo", branch ?? "HEAD");
	await service.readCommit("demo", local, file.revision);
	expect(client.readCommit).toHaveBeenCalledWith("/repo", file.revision);
	expect(client.initRepo).not.toHaveBeenCalled();
	expect(client.fetch).not.toHaveBeenCalled();
});
test.each(["initRepo", "fetch", "resolveRevision", "readFile", "publishRevision"] as const)(
	"cold %s failures remain explicit",
	async (operation) => {
		const { client, service } = fixture();
		const error = new GitClientError();
		client[operation].mockRejectedValue(error);
		await expect(service.fetchFile("demo", source)).rejects.toBe(error);
	},
);
test.each(["", "..", "../escape", "/absolute", "nested/service"])(
	"rejects unsafe identity %s before I/O",
	async (serviceId) => {
		const { client, service } = fixture();
		await expect(service.fetchFile(serviceId, source)).rejects.toBeInstanceOf(GitServiceError);
		expect(client.initRepo).not.toHaveBeenCalled();
	},
);
test.each([
	{ remote: "local", descriptorPath: "relative.yaml" },
	{ remote: "remote", descriptorPath: "/absolute.yaml" },
	{ remote: "remote", descriptorPath: "../escape.yaml" },
	{ remote: "remote", descriptorPath: "" },
])("rejects invalid source paths: %j", async (invalid) => {
	const { service } = fixture();
	await expect(service.fetchFile("demo", invalid)).rejects.toBeInstanceOf(GitServiceError);
});
