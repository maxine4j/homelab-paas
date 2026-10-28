import { expect, test, vi } from "vitest";

import type { GitFileSource } from "../git/types.ts";
import { PaasUiGitCache } from "./paas-ui-git-cache.ts";

const source: GitFileSource = { remote: "https://example.com/repo", descriptorPath: "service.yaml" };
const file = { revision: "one", content: "descriptor" };
const commit = { message: "Deploy", authorName: "Alex", authoredAt: "2026-10-28T00:00:00Z" };
const fixture = () => {
	let now = 0;
	const git = { fetchFile: vi.fn(async () => file), readCommit: vi.fn(async () => commit) };
	const cache = new PaasUiGitCache(git, () => now);
	return {
		git,
		cache,
		advance: (ms: number) => {
			now += ms;
		},
	};
};

test("cold reads return immediately and share one background load", async () => {
	const f = fixture();
	const pending = Promise.withResolvers<typeof file>();
	f.git.fetchFile.mockReturnValue(pending.promise);
	expect(await f.cache.fetchFile("demo", source)).toBeUndefined();
	expect(await f.cache.fetchFile("demo", source)).toBeUndefined();
	expect(f.git.fetchFile).toHaveBeenCalledTimes(1);
	pending.resolve(file);
	await vi.waitFor(async () => expect(await f.cache.fetchFile("demo", source)).toEqual(file));
	f.advance(59_999);
	expect(await f.cache.fetchFile("demo", source)).toEqual(file);
	expect(f.git.fetchFile).toHaveBeenCalledTimes(1);
});

test("expired reads return stale data while one refresh updates the cache", async () => {
	const f = fixture();
	await f.cache.fetchFile("demo", source);
	await vi.waitFor(async () => expect(await f.cache.fetchFile("demo", source)).toEqual(file));
	f.advance(60_000);
	const refresh = Promise.withResolvers<typeof file>();
	f.git.fetchFile.mockReturnValue(refresh.promise);
	expect(await f.cache.fetchFile("demo", source)).toEqual(file);
	expect(await f.cache.fetchFile("demo", source)).toEqual(file);
	expect(f.git.fetchFile).toHaveBeenCalledTimes(2);
	refresh.resolve({ ...file, revision: "two" });
	await vi.waitFor(async () => expect(await f.cache.fetchFile("demo", source)).toMatchObject({ revision: "two" }));
});

test("failed refreshes retain stale data and throttle retries, including cold failures", async () => {
	const f = fixture();
	await f.cache.fetchFile("demo", source);
	await vi.waitFor(async () => expect(await f.cache.fetchFile("demo", source)).toEqual(file));
	f.git.fetchFile.mockRejectedValue(new Error("remote unavailable"));
	f.advance(60_000);
	expect(await f.cache.fetchFile("demo", source)).toEqual(file);
	await vi.waitFor(() => expect(f.git.fetchFile).toHaveBeenCalledTimes(2));
	f.advance(59_999);
	expect(await f.cache.fetchFile("demo", source)).toEqual(file);
	expect(f.git.fetchFile).toHaveBeenCalledTimes(2);
	expect(await f.cache.fetchFile("other", source)).toBeUndefined();
	await vi.waitFor(() => expect(f.git.fetchFile).toHaveBeenCalledTimes(3));
	expect(await f.cache.fetchFile("other", source)).toBeUndefined();
	expect(f.git.fetchFile).toHaveBeenCalledTimes(3);
	f.advance(1);
	await f.cache.fetchFile("demo", source);
	await vi.waitFor(() => expect(f.git.fetchFile).toHaveBeenCalledTimes(4));
});

test("commit metadata is cached per service and exact revision with stale refresh", async () => {
	const f = fixture();
	expect(await f.cache.readCommit("demo", source, "one")).toBeUndefined();
	await vi.waitFor(async () => expect(await f.cache.readCommit("demo", source, "one")).toEqual(commit));
	expect(await f.cache.readCommit("demo", source, "two")).toBeUndefined();
	await vi.waitFor(async () => expect(await f.cache.readCommit("demo", source, "two")).toEqual(commit));
	expect(f.git.readCommit).toHaveBeenCalledTimes(2);
	f.advance(60_000);
	const refresh = Promise.withResolvers<typeof commit>();
	f.git.readCommit.mockReturnValue(refresh.promise);
	expect(await f.cache.readCommit("demo", source, "one")).toEqual(commit);
	expect(await f.cache.readCommit("demo", source, "one")).toEqual(commit);
	expect(f.git.readCommit).toHaveBeenCalledTimes(3);
	refresh.resolve({ ...commit, message: "Updated" });
	await vi.waitFor(async () =>
		expect(await f.cache.readCommit("demo", source, "one")).toMatchObject({ message: "Updated" }),
	);
});

test.each([
	{ remote: "https://example.com/other" },
	{ branch: "develop" },
	{ descriptorPath: "other.yaml" },
	{ accessToken: "new-token" },
	{ privateKeyPath: "/keys/new" },
])("source changes invalidate descriptor and metadata entries: %j", async (change) => {
	const f = fixture();
	await f.cache.fetchFile("demo", source);
	await f.cache.readCommit("demo", source, "one");
	await vi.waitFor(async () => expect(await f.cache.readCommit("demo", source, "one")).toEqual(commit));
	const changed = { ...source, ...change };
	expect(await f.cache.fetchFile("demo", changed)).toBeUndefined();
	expect(await f.cache.readCommit("demo", changed, "one")).toBeUndefined();
	await vi.waitFor(() => expect(f.git.readCommit).toHaveBeenCalledTimes(2));
	expect(f.git.fetchFile).toHaveBeenLastCalledWith("demo", changed);
	expect(f.git.readCommit).toHaveBeenLastCalledWith("demo", changed, "one");
});

test("background operations serialize without making other cold requests wait", async () => {
	const f = fixture();
	const pending = Promise.withResolvers<typeof file>();
	f.git.fetchFile.mockReturnValue(pending.promise);
	await f.cache.fetchFile("demo", source);
	expect(await f.cache.readCommit("demo", source, "one")).toBeUndefined();
	expect(await f.cache.fetchFile("other", source)).toBeUndefined();
	expect(f.git.readCommit).not.toHaveBeenCalled();
	expect(f.git.fetchFile).toHaveBeenCalledTimes(1);
	pending.resolve(file);
	await vi.waitFor(() => expect(f.git.fetchFile).toHaveBeenCalledTimes(2));
	expect(f.git.readCommit).toHaveBeenCalledTimes(1);
});
