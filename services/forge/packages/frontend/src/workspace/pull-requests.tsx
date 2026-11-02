import type { Workspace } from "@homelab-paas/forge-contracts";
import {
	pullRequestsSchema,
	pullRequestSchema,
	pullRequestDiffSchema,
	pullRequestPreviewSchema,
} from "@homelab-paas/forge-contracts/pull-requests";
import type {
	PullRequest,
	PullRequestSummary,
	PullRequestDiff,
	PullRequestPreview,
	Revision,
} from "@homelab-paas/forge-contracts/pull-requests";
import { useEffect, useState } from "react";

import type { IWorkspaceApi } from "../api/workspace-api.ts";
import { Patch } from "./changes.tsx";

const sameRevision = (first: Revision | undefined, second: Revision): boolean =>
	first?.head === second.head && first.baseSha === second.baseSha && first.mergeBase === second.mergeBase;

export const PullRequests = ({
	projectId,
	workspace,
	api,
}: {
	projectId: string;
	workspace?: Workspace;
	api: IWorkspaceApi;
}) => {
	const [items, setItems] = useState<PullRequestSummary[]>([]);
	const [selected, setSelected] = useState<PullRequest>();
	const [patch, setPatch] = useState<PullRequestDiff>();
	const [previewSource, setPreviewSource] = useState<{ workspaceId: string; value: PullRequestPreview }>();
	const preview = previewSource?.workspaceId === workspace?.id ? previewSource?.value : undefined;
	const setPreview = (value?: PullRequestPreview) =>
		setPreviewSource(value && workspace ? { workspaceId: workspace.id, value } : undefined);
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [editTitle, setEditTitle] = useState("");
	const [editBody, setEditBody] = useState("");
	const [comment, setComment] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(true);
	const list = async () => setItems(await api.read(`projects/${projectId}/pull-requests`, pullRequestsSchema));
	const run = async (action: () => Promise<void>) => {
		setBusy(true);
		setError("");
		try {
			await action();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "PR unavailable");
			setPatch(undefined);
		} finally {
			setBusy(false);
		}
	};
	useEffect(() => {
		void api
			.read(`projects/${projectId}/pull-requests`, pullRequestsSchema)
			.then(setItems)
			.catch(() => setError("PR list unavailable. Refresh the PR list to retry."))
			.finally(() => setBusy(false));
	}, [projectId, api]);
	const load = async (id: string) => {
		setPatch(undefined);
		const detail = await api.read(`pull-requests/${id}`, pullRequestSchema);
		setSelected(detail);
		setEditTitle(detail.title);
		setEditBody(detail.body);
		if (!detail.revision || detail.approval === "unavailable") return;
		const diff = await api.read(`pull-requests/${id}/diff`, pullRequestDiffSchema);
		if (!sameRevision(detail.revision, diff.revision)) {
			setError("Revision changed while loading. Refresh review.");
			return;
		}
		setPatch(diff);
	};
	const expected =
		patch && selected && sameRevision(selected.revision, patch.revision)
			? { expectedHead: patch.revision.head, expectedBase: patch.revision.baseSha }
			: undefined;
	const mutate = async (method: string, suffix: string, input: object) => {
		if (!selected || !expected) return;
		const detail = await api.read(`pull-requests/${selected.id}${suffix}`, pullRequestSchema, method, {
			...expected,
			...input,
		});
		setSelected(detail);
		if (!patch || !sameRevision(detail.revision, patch.revision)) setPatch(undefined);
		setEditTitle(detail.title);
		setEditBody(detail.body);
		setComment("");
		await list();
	};
	return (
		<section aria-label='Pull requests'>
			<h3>Pull requests</h3>
			{error && (
				<p role='alert' className='error'>
					{error}
				</p>
			)}
			<button disabled={busy} onClick={() => void run(list)}>
				Refresh PR list
			</button>
			<nav className='toolbar' aria-label='PR list'>
				{items.map((item) => (
					<button
						disabled={busy}
						key={item.id}
						aria-label={item.title}
						onClick={() => void run(() => load(item.id))}
					>
						{item.title} · {item.status}
					</button>
				))}
			</nav>
			{items.length === 0 && <p>No pull requests</p>}
			{workspace?.status === "ready" && (
				<section aria-label='Create pull request'>
					<h4>New pull request</h4>
					<label>
						New PR title
						<input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
					</label>
					<label>
						New PR description
						<textarea value={body} maxLength={8192} onChange={(event) => setBody(event.target.value)} />
					</label>
					<button
						disabled={busy}
						onClick={() =>
							void run(async () =>
								setPreview(
									await api.read(
										`workspaces/${workspace.id}/pull-request-revision`,
										pullRequestPreviewSchema,
									),
								),
							)
						}
					>
						Preview PR revision
					</button>
					{preview && (
						<p className='branch'>
							{preview.revision.baseSha} → {preview.revision.head}
							{preview.hasChanges ? " · Committed changes available" : " · No committed changes"}
						</p>
					)}
					<button
						disabled={busy || !title.trim() || !preview?.hasChanges}
						onClick={() =>
							void run(async () => {
								if (!preview) return;
								const created = await api.read(
									`projects/${projectId}/pull-requests`,
									pullRequestSchema,
									"POST",
									{
										workspaceId: workspace.id,
										title,
										body,
										expectedHead: preview.revision.head,
										expectedBase: preview.revision.baseSha,
									},
								);
								setSelected(created);
								setEditTitle(created.title);
								setEditBody(created.body);
								setTitle("");
								setBody("");
								setPreview(undefined);
								setPatch(undefined);
								await list();
							})
						}
					>
						Create PR
					</button>
				</section>
			)}
			{selected && (
				<article aria-label='PR detail'>
					<h4>{selected.title}</h4>
					<p>{selected.body}</p>
					<p>Review into main · {selected.status}</p>
					<p>Approval: {selected.approval}</p>
					<button disabled={busy} onClick={() => void run(() => load(selected.id))}>
						Refresh review
					</button>
					{patch && (
						<>
							<p className='branch'>Committed changes into main</p>
							<Patch section={patch.diff} />
						</>
					)}
					{!patch && <p>Review unavailable until a matching committed diff is loaded.</p>}
					<label>
						PR title
						<input
							value={editTitle}
							maxLength={120}
							onChange={(event) => setEditTitle(event.target.value)}
						/>
					</label>
					<label>
						PR description
						<textarea
							value={editBody}
							maxLength={8192}
							onChange={(event) => setEditBody(event.target.value)}
						/>
					</label>
					<button
						disabled={busy || !expected || !editTitle.trim()}
						onClick={() => void run(() => mutate("PATCH", "", { title: editTitle, body: editBody }))}
					>
						Save PR metadata
					</button>
					<button
						disabled={busy || !expected}
						onClick={() =>
							void run(() =>
								mutate("PATCH", "", { status: selected.status === "open" ? "closed" : "open" }),
							)
						}
					>
						{selected.status === "open" ? "Close PR" : "Reopen PR"}
					</button>
					<h4>Discussion</h4>
					{selected.discussion.map((entry) => (
						<article key={entry.id}>
							<p>
								{entry.kind} · {entry.createdAt}
								{selected.revision && !sameRevision(entry.revision, selected.revision)
									? " · Stale revision"
									: ""}
							</p>
							<p>{entry.body}</p>
							<small className='branch'>
								{entry.revision.baseSha} → {entry.revision.head}
							</small>
						</article>
					))}
					<label>
						Review or comment
						<textarea
							value={comment}
							maxLength={8192}
							onChange={(event) => setComment(event.target.value)}
						/>
					</label>
					<div className='toolbar'>
						<button
							disabled={busy || !expected || selected.status !== "open" || !comment.trim()}
							onClick={() => void run(() => mutate("POST", "/comments", { body: comment }))}
						>
							Add comment
						</button>
						{(["approve", "request-changes"] as const).map((decision) => (
							<button
								key={decision}
								disabled={busy || !expected || selected.status !== "open"}
								onClick={() => void run(() => mutate("POST", "/reviews", { decision, body: comment }))}
							>
								{decision === "approve" ? "Approve" : "Request changes"}
							</button>
						))}
					</div>
				</article>
			)}
		</section>
	);
};
