import { z } from "zod";

import { filePathSchema, gitShaSchema, treePathSchema } from "./workspace.ts";

const countSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const commitDiffLineSchema = z
	.strictObject({
		kind: z.enum(["context", "addition", "deletion", "no-newline"]),
		text: z.string().max(262144),
		oldLine: countSchema.min(1).optional(),
		newLine: countSchema.min(1).optional(),
	})
	.refine((line) => {
		if (line.kind === "context") return line.oldLine !== undefined && line.newLine !== undefined;
		if (line.kind === "addition") return line.oldLine === undefined && line.newLine !== undefined;
		if (line.kind === "deletion") return line.oldLine !== undefined && line.newLine === undefined;
		return line.oldLine === undefined && line.newLine === undefined;
	});
export const commitDiffFileSchema = z.strictObject({
	oldPath: z.string().max(4096),
	newPath: z.string().max(4096),
	oldMode: z.string().regex(/^[0-7]{6}$/),
	newMode: z.string().regex(/^[0-7]{6}$/),
	status: z.enum(["added", "deleted", "modified", "renamed", "type-changed"]),
	additions: countSchema.optional(),
	deletions: countSchema.optional(),
	binary: z.boolean(),
	unsupported: z.boolean(),
	truncated: z.boolean(),
	hunks: z
		.array(
			z.strictObject({
				oldStart: countSchema,
				oldCount: countSchema,
				newStart: countSchema,
				newCount: countSchema,
				lines: z.array(commitDiffLineSchema).max(1000),
			}),
		)
		.max(1000),
});
export const repositoryCommitDetailSchema = z
	.strictObject({
		sha: gitShaSchema,
		subject: z.string().max(4096),
		body: z.string().max(32768),
		author: z.string().max(1024),
		date: z.iso.datetime({ offset: true }),
		parents: z.array(gitShaSchema).max(100),
		comparisonBase: gitShaSchema,
		files: z.array(commitDiffFileSchema).max(100),
		omittedFiles: countSchema,
		totalsComplete: z.boolean(),
		metadataTruncated: z.boolean(),
	})
	.refine((detail) => {
		const lines = detail.files.flatMap((file) => file.hunks.flatMap((hunk) => hunk.lines));
		return (
			lines.length <= 1000
			&& lines.reduce((size, line) => size + new TextEncoder().encode(line.text).length, 0) <= 262144
			&& new TextEncoder().encode(JSON.stringify(detail)).length <= 1048576
		);
	});

export const branchNameSchema = z
	.string()
	.min(1)
	.max(255)
	.refine(
		(name) =>
			!name.startsWith("-")
			&& !name.startsWith("/")
			&& !name.endsWith("/")
			&& !name.endsWith(".")
			// eslint-disable-next-line no-control-regex
			&& !/[\s~^:?*[\\\u0000-\u001f\u007f]/u.test(name)
			&& !name.includes("..")
			&& !name.includes("@{")
			&& name.split("/").every((part) => part && !part.startsWith(".") && !part.endsWith(".lock")),
	);
export const repositoryCommitSchema = z.strictObject({
	sha: gitShaSchema,
	subject: z.string().max(4096),
	author: z.string().max(1024),
	date: z.iso.datetime({ offset: true }),
});
export const repositoryBranchesSchema = z
	.array(z.strictObject({ name: branchNameSchema, sha: gitShaSchema }))
	.max(1000);
export const repositoryTreeSchema = z.strictObject({
	path: treePathSchema,
	head: gitShaSchema,
	entries: z
		.array(
			z.strictObject({
				name: z.string(),
				path: filePathSchema,
				kind: z.enum(["file", "directory"]),
				lastCommit: repositoryCommitSchema.optional(),
			}),
		)
		.max(1000),
	truncated: z.boolean(),
});
export const repositoryHistorySchema = z.strictObject({
	head: gitShaSchema,
	commits: z.array(repositoryCommitSchema).max(100),
	hasMore: z.boolean(),
});
export const repositoryFileSchema = z.strictObject({ path: filePathSchema, content: z.string().max(262144) });
export const repositoryCommitInputSchema = z
	.strictObject({
		branch: branchNameSchema,
		expectedHead: gitShaSchema,
		message: z.string().trim().min(1).max(4096),
		files: z
			.array(repositoryFileSchema.refine((file) => new TextEncoder().encode(file.content).length <= 262144))
			.min(1)
			.max(100),
	})
	.refine(({ files }) => new Set(files.map((file) => file.path)).size === files.length)
	.refine(
		({ files }) => files.reduce((size, file) => size + new TextEncoder().encode(file.content).length, 0) <= 1048576,
	)
	.refine(({ files }) => files.every((file) => !file.content.includes("\0")));
export const repositoryCommitResultSchema = z.strictObject({ head: gitShaSchema });
export type RepositoryCommit = z.infer<typeof repositoryCommitSchema>;
export type RepositoryBranch = z.infer<typeof repositoryBranchesSchema>[number];
export type RepositoryTree = z.infer<typeof repositoryTreeSchema>;
export type RepositoryHistory = z.infer<typeof repositoryHistorySchema>;
export type RepositoryFile = z.infer<typeof repositoryFileSchema>;
