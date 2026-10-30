import { expect, test } from "vitest";

import { gitCommitLink, gitSourceLink } from "./git-source-link.ts";

test("commit links use the full revision and support HTTPS and SSH GitHub sources", () => {
	for (const remote of ["https://github.com/owner/repo.git", "git@github.com:owner/repo.git"])
		expect(gitCommitLink({ remote }, "abc1234def")).toBe("https://github.com/owner/repo/commit/abc1234def");
	for (const remote of ["local", "https://token@github.com/owner/repo.git", "https://example.com/owner/repo.git"])
		expect(gitCommitLink({ remote }, "abc1234def")).toBeUndefined();
	expect(gitCommitLink({ remote: "https://github.com/owner/repo.git" })).toBeUndefined();
});

test("GitHub descriptor links pin the fetched revision and encode path segments", () => {
	expect(
		gitSourceLink(
			{ remote: "https://github.com/owner/repo.git", branch: "main", descriptorPath: "config/my service.yaml" },
			"abc123",
		),
	).toBe("https://github.com/owner/repo/blob/abc123/config/my%20service.yaml");
	expect(gitSourceLink({ remote: "git@github.com:owner/repo.git", descriptorPath: "service.yaml" }, "abc123")).toBe(
		"https://github.com/owner/repo/blob/abc123/service.yaml",
	);
});

test("source links require a supported web host, safe path and a known revision", () => {
	for (const remote of [
		"local",
		"javascript:alert(1)",
		"https://token@github.com/owner/repo.git",
		"https://example.com/owner/repo.git",
	])
		expect(gitSourceLink({ remote, descriptorPath: "service.yaml" }, "abc123")).toBeUndefined();
	expect(
		gitSourceLink({ remote: "https://github.com/owner/repo.git", descriptorPath: "../service.yaml" }, "abc123"),
	).toBeUndefined();
	expect(
		gitSourceLink({ remote: "https://github.com/owner/repo.git", descriptorPath: "service.yaml" }),
	).toBeUndefined();
});
