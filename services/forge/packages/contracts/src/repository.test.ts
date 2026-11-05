import { expect, test } from "vitest";

import { repositoryCommitDetailSchema, commitDiffLineSchema } from "./repository.ts";

const detail = {
	sha: "a".repeat(40),
	subject: "Initial",
	body: "",
	author: "Owner",
	date: "2026-11-02T00:00:00Z",
	parents: [],
	comparisonBase: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
	files: [],
	omittedFiles: 0,
	totalsComplete: true,
	metadataTruncated: false,
};
test("accepts bounded commit details and rejects malformed identities, counts and oversized metadata", () => {
	expect(repositoryCommitDetailSchema.safeParse(detail).success).toBe(true);
	for (const value of [
		{ ...detail, sha: "main" },
		{ ...detail, omittedFiles: -1 },
		{ ...detail, body: "x".repeat(32769) },
	])
		expect(repositoryCommitDetailSchema.safeParse(value).success).toBe(false);
});

test("line contracts require positive side-specific numbers and bound aggregate lines and escaped JSON", () => {
	expect(commitDiffLineSchema.safeParse({ kind: "addition", text: "a", newLine: 0 }).success).toBe(false);
	expect(commitDiffLineSchema.safeParse({ kind: "deletion", text: "a", newLine: 1 }).success).toBe(false);
	const file = {
		oldPath: "a",
		newPath: "a",
		oldMode: "100644",
		newMode: "100644",
		status: "modified",
		binary: false,
		unsupported: false,
		truncated: false,
		additions: 1000,
		deletions: 0,
		hunks: [
			{
				oldStart: 0,
				oldCount: 0,
				newStart: 1,
				newCount: 1000,
				lines: Array.from({ length: 1000 }, (_, i) => ({ kind: "addition", text: "a", newLine: i + 1 })),
			},
		],
	};
	expect(repositoryCommitDetailSchema.safeParse({ ...detail, files: [file] }).success).toBe(true);
	expect(repositoryCommitDetailSchema.safeParse({ ...detail, files: [file, file] }).success).toBe(false);
	expect(
		repositoryCommitDetailSchema.safeParse({
			...detail,
			files: [
				{
					...file,
					hunks: [
						{ ...file.hunks[0], lines: [{ kind: "addition", text: "\u0001".repeat(200000), newLine: 1 }] },
					],
				},
			],
		}).success,
	).toBe(false);
});
