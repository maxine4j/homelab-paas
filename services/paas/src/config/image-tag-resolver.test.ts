import { expect, test } from "vitest";

import { resolveImageTag } from "./image-tag-resolver.ts";

const revision = "abcdef0123456789abcdef0123456789abcdef01";

test.each([revision, revision + "a".repeat(24)])("expands commit prefixes in image tags for revision %s", (commit) => {
	expect(resolveImageTag("registry:5000/team/app:git-${COMMIT_ID:7}-${COMMIT_ID:1}", commit)).toBe(
		"registry:5000/team/app:git-abcdef0-a",
	);
	expect(resolveImageTag(`app:${"${COMMIT_ID:" + commit.length + "}"}`, commit)).toBe(`app:${commit}`);
});

test.each(["app:latest", "registry:5000/team/app", "app@sha256:abcdef"])(
	"preserves literal image %s without a revision",
	(image) => expect(resolveImageTag(image)).toBe(image),
);

test.each([
	"app:${COMMIT_ID:0}",
	"app:${COMMIT_ID:-1}",
	"app:${COMMIT_ID:1.5}",
	"app:${COMMIT_ID:01}",
	"app:${COMMIT_ID:41}",
	"app:${COMMIT_ID:999999999999999999999}",
	"app:${COMMIT_ID}",
	"app:${COMMIT_ID:}",
	"app:${COMMIT_ID:7",
	"app:${UNKNOWN:7}",
	"${COMMIT_ID:7}/app:latest",
	"registry:${COMMIT_ID:7}/app:latest",
	"app@sha256:${COMMIT_ID:7}",
	"app:${COMMIT_ID:7}@sha256:abcdef",
	"app:-${COMMIT_ID:7}",
	`app:${"a".repeat(128)}${"${COMMIT_ID:1}"}`,
])("rejects invalid or misplaced image variables in %s", (image) => {
	expect(() => resolveImageTag(image, revision)).toThrow("Invalid image tag variables");
});

test.each([undefined, "main", "a".repeat(39), "z".repeat(40)])(
	"requires a resolved Git commit when expanding variables (%s)",
	(commit) => {
		expect(() => resolveImageTag("app:${COMMIT_ID:7}", commit)).toThrow("Invalid image tag variables");
	},
);
