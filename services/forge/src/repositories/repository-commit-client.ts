import { join } from "node:path";

import {
	filePathSchema,
	gitShaSchema,
	projectIdSchema,
	repositoryCommitDetailSchema,
	type RepositoryCommitDetail,
	type CommitDiffFile,
	type CommitDiffLine,
} from "@homelab-paas/forge-contracts";

import { WorkspaceError } from "../workspaces/errors.ts";
import { CommitNotFoundError } from "./errors.ts";
import type { IGitBinaryTransport } from "./git-transport.ts";
import type { IRepositoryClient } from "./repository-client.ts";

export interface IRepositoryCommitClient {
	/** Immutable bounded read. Invalid input, missing objects and infrastructure failures are distinct safe errors. */
	read(id: string, sha: string): Promise<RepositoryCommitDetail>;
}

export class RepositoryCommitClient implements IRepositoryCommitClient {
	constructor(
		private readonly root: string,
		private readonly git: IGitBinaryTransport,
		private readonly repositories: IRepositoryClient,
	) {}
	async read(id: string, sha: string): Promise<RepositoryCommitDetail> {
		if (!projectIdSchema.safeParse(id).success || !gitShaSchema.safeParse(sha).success)
			throw new WorkspaceError("invalid-request");
		try {
			await this.repositories.verify(id);
			// --batch-check reports absence without conflating command failures with missing objects.
			const object = (
				await this.run(id, ["cat-file", "--batch-check=%(objectname) %(objecttype)"], `${sha}\n`)
			).trim();
			if (object === `${sha} missing` || (object.startsWith(`${sha} `) && object !== `${sha} commit`))
				throw new CommitNotFoundError();
			if (object !== `${sha} commit`) throw new Error("Invalid Git object response");
			const metadata = await this.run(id, ["cat-file", "commit", sha]);
			const divider = metadata.indexOf("\n\n");
			if (divider < 0) throw new Error("Invalid commit metadata");
			const headers = metadata.slice(0, divider).split("\n");
			const parents = headers
				.filter((line) => line.startsWith("parent "))
				.map((line) => gitShaSchema.parse(line.slice(7)));
			const author = /^author (.*) <[^\n]*> (\d+) [+-]\d{4}$/mu.exec(metadata.slice(0, divider));
			if (!author) throw new Error("Invalid author metadata");
			const message = metadata.slice(divider + 2).replace(/\n$/u, "");
			const subject = message.split("\n").at(0) ?? "";
			const body = message.slice(subject.length).replace(/^\n+/u, "");
			const comparisonBase = parents.at(0) ?? "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
			const raw = (
				await this.git.runBytes(
					this.args(id, [
						"diff-tree",
						"--no-commit-id",
						"--raw",
						"--no-abbrev",
						"-r",
						"-z",
						"-M50%",
						"-l100",
						"--no-ext-diff",
						"--no-textconv",
						comparisonBase,
						sha,
						"--",
					]),
				)
			).toString("utf8");
			const records = raw.split("\0");
			const files: CommitDiffFile[] = [];
			let total = 0;
			const budget = { lines: 1000, bytes: 262144 };
			for (let index = 0; index < records.length - 1;) {
				const header = /^:([0-7]{6}) ([0-7]{6}) ([a-f0-9]{40}) ([a-f0-9]{40}) ([AMDTR])\d*$/u.exec(
					records.at(index++)!,
				);
				if (!header) throw new Error("Invalid raw diff metadata");
				const oldPath = records.at(index++);
				const newPath = header.at(5) === "R" ? records.at(index++) : oldPath;
				if (oldPath === undefined || newPath === undefined) throw new Error("Missing diff path");
				total++;
				if (files.length >= 100) continue;
				const file: CommitDiffFile = {
					oldPath: oldPath.slice(0, 4096),
					newPath: newPath.slice(0, 4096),
					oldMode: header.at(1)!,
					newMode: header.at(2)!,
					status:
						header.at(5) === "A"
							? "added"
							: header.at(5) === "D"
								? "deleted"
								: header.at(5) === "R"
									? "renamed"
									: header.at(5) === "T"
										? "type-changed"
										: "modified",
					binary: false,
					unsupported: false,
					truncated: false,
					hunks: [],
				};
				files.push(file);
				file.unsupported =
					!["000000", "100644", "100755"].includes(file.oldMode)
					|| !["000000", "100644", "100755"].includes(file.newMode)
					|| !filePathSchema.safeParse(oldPath).success
					|| !filePathSchema.safeParse(newPath).success
					|| oldPath.includes("\ufffd")
					|| newPath.includes("\ufffd");
				if (file.unsupported) continue;
				const ids = [header.at(3)!, header.at(4)!].filter((oid) => oid !== "0".repeat(40));
				let size = 0;
				for (const oid of ids) {
					const bytes = Number((await this.run(id, ["cat-file", "-s", oid])).trim());
					if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Invalid blob size");
					size += bytes;
				}
				// Bound work before asking Git to materialize a patch. Oversized content is explicit.
				if (size > 131072 || budget.bytes <= 0 || budget.lines <= 0) {
					file.truncated = true;
					continue;
				}
				for (const oid of ids) {
					const bytes = await this.git.runBytes(this.args(id, ["cat-file", "blob", oid]));
					try {
						new TextDecoder("utf-8", { fatal: true }).decode(bytes);
					} catch {
						file.binary = true;
					}
					if (bytes.includes(0)) file.binary = true;
				}
				if (file.binary) continue;
				const patch = await this.run(id, [
					"diff",
					"--no-ext-diff",
					"--no-textconv",
					"--no-color",
					"--no-relative",
					"--unified=3",
					"--diff-algorithm=myers",
					"-M50%",
					"-l100",
					comparisonBase,
					sha,
					"--",
					...new Set([oldPath, newPath]),
				]);
				if (patch.includes("\nBinary files ")) {
					file.binary = true;
					continue;
				}
				this.parsePatch(file, patch, budget);
			}
			const detail: RepositoryCommitDetail = {
				sha,
				subject: subject.slice(0, 4096),
				body: body.slice(0, 32768),
				author: author.at(1)!.slice(0, 1024),
				date: new Date(Number(author.at(2)) * 1000).toISOString(),
				parents: parents.slice(0, 100),
				comparisonBase,
				files,
				omittedFiles: total - files.length,
				totalsComplete:
					total === files.length
					&& files.every((file) => file.additions !== undefined && file.deletions !== undefined),
				metadataTruncated:
					subject.length > 4096 || body.length > 32768 || author.at(1)!.length > 1024 || parents.length > 100,
			};
			// JSON escaping counts toward the wire budget, including unsupported path summaries.
			while (Buffer.byteLength(JSON.stringify(detail)) > 1048576 && detail.files.length) {
				detail.files.pop();
				detail.omittedFiles++;
				detail.totalsComplete = false;
			}
			return repositoryCommitDetailSchema.parse(detail);
		} catch (cause) {
			if (cause instanceof CommitNotFoundError || cause instanceof WorkspaceError) throw cause;
			throw new WorkspaceError("workspace-unavailable", { cause });
		}
	}
	private parsePatch(file: CommitDiffFile, patch: string, budget: { lines: number; bytes: number }): void {
		file.additions = 0;
		file.deletions = 0;
		let hunk: CommitDiffFile["hunks"][number] | undefined;
		let oldLine = 0;
		let newLine = 0;
		for (const line of patch.split("\n").slice(0, -1)) {
			const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(line);
			if (match) {
				oldLine = Number(match.at(1));
				newLine = Number(match.at(3));
				hunk = {
					oldStart: oldLine,
					oldCount: Number(match.at(2) ?? 1),
					newStart: newLine,
					newCount: Number(match.at(4) ?? 1),
					lines: [],
				};
				continue;
			}
			if (!hunk) continue;
			const kind = line.startsWith("+")
				? "addition"
				: line.startsWith("-")
					? "deletion"
					: line.startsWith(" ")
						? "context"
						: line === "\\ No newline at end of file"
							? "no-newline"
							: undefined;
			if (!kind) throw new Error("Invalid diff line");
			if (kind === "addition") file.additions++;
			if (kind === "deletion") file.deletions++;
			const text = line.slice(kind === "no-newline" ? 2 : 1);
			const value: CommitDiffLine = {
				kind,
				text,
				...(kind === "context" || kind === "deletion" ? { oldLine: oldLine++ } : {}),
				...(kind === "context" || kind === "addition" ? { newLine: newLine++ } : {}),
			};
			const bytes = Buffer.byteLength(text);
			if (budget.lines <= 0 || bytes > budget.bytes || file.truncated) {
				file.truncated = true;
				continue;
			}
			budget.lines--;
			budget.bytes -= bytes;
			if (!hunk.lines.length) file.hunks.push(hunk);
			hunk.lines.push(value);
		}
	}
	private args(id: string, args: string[]): string[] {
		return [
			"--no-replace-objects",
			"--literal-pathspecs",
			"-C",
			join(this.root, "repositories", `${id}.git`),
			...args,
		];
	}
	private run(id: string, args: string[], input?: string): Promise<string> {
		return this.git.run(this.args(id, args), input);
	}
}
