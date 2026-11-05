import { repositoryCommitDetailSchema, type RepositoryCommitDetail } from "@homelab-paas/forge-contracts";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";

import type { IWorkspaceApi } from "../api/workspace-api.ts";
import { CommitDiff } from "./commit-diff.tsx";
import { commitHref } from "./repository-navigation.ts";

export const RepositoryCommitView = ({
	projectId,
	sha,
	mode,
	api,
}: {
	projectId: string;
	sha: string;
	mode: "unified" | "split";
	api: IWorkspaceApi;
}) => {
	const location = useLocation();
	const [detail, setDetail] = useState<RepositoryCommitDetail>();
	const [error, setError] = useState("");
	const [revision, setRevision] = useState(0);
	const [notice, setNotice] = useState("");
	useEffect(() => {
		let cancelled = false;
		void api
			.read(`projects/${projectId}/repository/commits/${sha}`, repositoryCommitDetailSchema)
			.then((value) => {
				if (!cancelled) {
					if (value.sha !== sha) {
						setError("Unexpected commit response. Retry commit.");
						return;
					}
					setDetail(value);
				}
			})
			.catch((failure: unknown) => {
				if (!cancelled)
					setError(failure instanceof Error ? failure.message : "Commit unavailable. Retry commit.");
			});
		return () => {
			cancelled = true;
		};
	}, [api, projectId, sha, revision]);
	useEffect(() => {
		if (!detail || !/^#diff-\d+$/u.test(location.hash)) return;
		const frame = requestAnimationFrame(() =>
			document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" }),
		);
		return () => cancelAnimationFrame(frame);
	}, [detail, location.hash, mode]);
	const href = (value: string, selectedMode = mode, anchor = "") =>
		commitHref(projectId, location.search, value, selectedMode, anchor);
	if (error)
		return (
			<section className='commit-view'>
				<p role='alert'>{error}</p>
				<button
					onClick={() => {
						setDetail(undefined);
						setError("");
						setNotice("");
						setRevision((value) => value + 1);
					}}
				>
					Retry commit
				</button>
			</section>
		);
	if (!detail) return <p role='status'>Loading commit…</p>;
	const additions = detail.files.reduce((count, file) => count + (file.additions ?? 0), 0);
	const deletions = detail.files.reduce((count, file) => count + (file.deletions ?? 0), 0);
	return (
		<section className='commit-view' aria-label='Commit details'>
			<header className='commit-metadata'>
				<h2>{detail.subject || "Untitled commit"}</h2>
				{detail.body && <pre>{detail.body}</pre>}
				<p>
					{detail.author} · <time dateTime={detail.date}>{new Date(detail.date).toLocaleString()}</time>
				</p>
				<div className='commit-identity'>
					<code>{detail.sha}</code>
					<button
						onClick={() => {
							void Promise.resolve()
								.then(() => navigator.clipboard.writeText(detail.sha))
								.then(
									() => setNotice("SHA copied"),
									() => setNotice("Copy failed. Select and copy the SHA manually."),
								);
						}}
						aria-label='Copy full SHA'
					>
						Copy SHA
					</button>
				</div>
				{notice && <p role='status'>{notice}</p>}
				<nav aria-label='Commit parents'>
					{detail.parents.map((value) => (
						<Link key={value} to={href(value)} aria-label={`Parent ${value.slice(0, 7)}`}>
							{value.slice(0, 7)}
						</Link>
					))}
				</nav>
				<p>
					{detail.parents.length > 1
						? "Merge commit · Comparing with first parent"
						: detail.parents.length
							? "Comparing with parent"
							: "Root commit · Comparing with empty tree"}
				</p>
				{detail.metadataTruncated && <p className='notice'>Some commit metadata is omitted.</p>}
			</header>
			<div className='commit-summary'>
				<strong>
					{detail.files.length} changed files
					{detail.omittedFiles > 0 ? ` · ${detail.omittedFiles} files omitted` : ""}
				</strong>
				<span>
					+{additions} additions · −{deletions} deletions{!detail.totalsComplete && " · Incomplete totals"}
				</span>
				<nav aria-label='Diff mode'>
					<Link
						to={href(sha, "unified", location.hash.slice(1))}
						aria-current={mode === "unified" ? "true" : undefined}
					>
						Unified
					</Link>
					<Link
						className='split-mode-link'
						to={href(sha, "split", location.hash.slice(1))}
						aria-current={mode === "split" ? "true" : undefined}
					>
						Split
					</Link>
				</nav>
			</div>
			{detail.files.length === 0 && detail.omittedFiles === 0 && <p>No file changes</p>}
			<div className='commit-layout'>
				<nav className='commit-file-nav' aria-label='Changed files'>
					{detail.files.map((file, index) => (
						<Link key={index} to={href(sha, mode, `diff-${index}`)}>
							{file.status === "deleted" ? file.oldPath : file.newPath}
						</Link>
					))}
				</nav>
				<div className='commit-panels'>
					{detail.files.map((file, index) => (
						<CommitDiff key={index} id={`diff-${index}`} file={file} mode={mode} />
					))}
				</div>
			</div>
		</section>
	);
};
