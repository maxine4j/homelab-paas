import {
	repositoryBranchesSchema,
	repositoryTreeSchema,
	repositoryFileSchema,
	repositoryHistorySchema,
	repositoryCommitResultSchema,
	filePathSchema,
	type RepositoryBranch,
	type RepositoryTree,
	type RepositoryFile,
	type RepositoryHistory,
} from "@homelab-paas/forge-contracts";
import { useCallback, useEffect, useId, useState, type ReactNode } from "react";

import type { IWorkspaceApi } from "../api/workspace-api.ts";
import { Editor } from "./editor.tsx";
import { FileIcon } from "./file-icon.tsx";
import { RepositoryFileTree } from "./repository-file-tree.tsx";

const ChangedAt = ({ date }: { date?: string }) =>
	date ? (
		<time dateTime={date}>
			{new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
		</time>
	) : (
		<span>—</span>
	);

const Readme = ({ content }: { content: string }) => (
	<div className='readme-content'>
		{content.split(/\n\s*\n/u).map((block, index) => {
			if (block.startsWith("# ")) return <h1 key={index}>{block.slice(2)}</h1>;
			if (block.startsWith("## ")) return <h2 key={index}>{block.slice(3)}</h2>;
			if (block.startsWith("### ")) return <h3 key={index}>{block.slice(4)}</h3>;
			if (block.startsWith("```"))
				return (
					<pre key={index}>
						<code>{block.replace(/^```[^\n]*\n/u, "").replace(/\n```$/u, "")}</code>
					</pre>
				);
			return <p key={index}>{block}</p>;
		})}
	</div>
);

interface Draft {
	original?: string;
	content: string;
}

const BranchBrowser = ({
	root,
	branch,
	api,
	dirtyChange,
	branchControl,
}: {
	branchControl: ReactNode;
	root: string;
	branch: string;
	api: IWorkspaceApi;
	dirtyChange: (branch: string, dirty: boolean) => void;
}) => {
	const editorId = useId();
	const [tree, setTree] = useState<RepositoryTree>();
	const [baseHead, setBaseHead] = useState("");
	const [path, setPath] = useState("");
	const [drafts, setDrafts] = useState<Record<string, Draft>>({});
	const [active, setActive] = useState("");
	const [readmeResult, setReadmeResult] = useState<{ key: string; file?: RepositoryFile; error?: string }>();
	const [history, setHistory] = useState<RepositoryHistory>();
	const [showAll, setShowAll] = useState(false);
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [message, setMessage] = useState("");
	const [newPath, setNewPath] = useState("");
	const [revision, setRevision] = useState(0);
	const [notice, setNotice] = useState("");
	const changed = Object.entries(drafts).filter(([, draft]) => draft.original !== draft.content);
	const dirty = changed.length > 0;
	const disabled = busy || loading;
	const draft = drafts[active];
	const entries = [...(tree?.entries ?? [])].sort((a, b) =>
		a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1,
	);
	const readmePath = entries.find(
		(entry) => entry.kind === "file" && /^readme(?:\.(?:md|markdown|txt))?$/iu.test(entry.name),
	)?.path;
	const readmeKey = `${revision}:${readmePath ?? ""}`;
	const readme = readmeResult?.key === readmeKey ? readmeResult.file : undefined;
	const readmeError = readmeResult?.key === readmeKey ? readmeResult.error : undefined;
	const loadTree = useCallback(
		(directory: string) =>
			api.read(
				`${root}/tree?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(directory)}`,
				repositoryTreeSchema,
			),
		[api, root, branch],
	);
	useEffect(() => {
		dirtyChange(branch, dirty);
	}, [dirtyChange, branch, dirty]);
	useEffect(() => {
		let cancelled = false;
		void loadTree(path)
			.then((value) => {
				if (cancelled) return;
				setTree(value);
				setBaseHead((current) => current || value.head);
			})
			.catch(() => {
				if (!cancelled) setError("Files unavailable. Retry loading files.");
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [loadTree, path, revision]);
	useEffect(() => {
		let cancelled = false;
		if (readmePath)
			void api
				.read(
					`${root}/file?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(readmePath)}`,
					repositoryFileSchema,
				)
				.then((value) => {
					if (!cancelled) setReadmeResult({ key: readmeKey, file: value });
				})
				.catch(() => {
					if (!cancelled)
						setReadmeResult({
							key: readmeKey,
							error: "README preview unavailable. Open the file to inspect it.",
						});
				});
		return () => {
			cancelled = true;
		};
	}, [api, root, branch, readmePath, readmeKey]);
	const run = async (action: () => Promise<void>) => {
		setBusy(true);
		setError("");
		setNotice("");
		try {
			await action();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Operation failed");
		} finally {
			setBusy(false);
		}
	};
	const open = async (file: string) => {
		if (!Object.hasOwn(drafts, file)) {
			const value = await api.read(
				`${root}/file?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(file)}`,
				repositoryFileSchema,
			);
			setDrafts((current) => ({ ...current, [file]: { original: value.content, content: value.content } }));
		}
		setActive(file);
		setHistory(undefined);
	};
	const browse = (directory: string) => {
		if (path !== directory) {
			setLoading(true);
			setTree(undefined);
		}
		setPath(directory);
		setActive("");
		setHistory(undefined);
		setShowAll(false);
	};
	const showHistory = async (more = false) => {
		const value = await api.read(
			`${root}/history?branch=${encodeURIComponent(branch)}&offset=${more ? (history?.commits.length ?? 0) : 0}`,
			repositoryHistorySchema,
		);
		if (more && history && value.head !== history.head)
			throw new Error("Branch changed. Reopen commit history to refresh.");
		setHistory(more && history ? { ...value, commits: [...history.commits, ...value.commits] } : value);
	};
	const header = (
		<div className='file-list-header'>
			<span>{history ? "Commits" : active || path || "Files"}</span>
			<div>
				{(active || history) && (
					<button
						disabled={disabled}
						onClick={() => {
							setActive("");
							setHistory(undefined);
						}}
					>
						Back to files
					</button>
				)}
				<button
					className='history-button'
					aria-label='Commit history'
					title='Commit history'
					disabled={disabled}
					onClick={() => void run(() => showHistory())}
				>
					<svg width='18' height='18' viewBox='0 0 20 20' aria-hidden='true'>
						<path
							d='M3 8a7 7 0 1 1 0 5M3 3v5h5m2-3v5l3 2'
							fill='none'
							stroke='currentColor'
							strokeWidth='1.6'
						/>
					</svg>
				</button>
			</div>
		</div>
	);
	return (
		<div className='branch-browser' aria-busy={disabled}>
			<div className='repository-toolbar'>
				{branchControl}
				<nav aria-label='File path'>
					<button disabled={disabled} onClick={() => browse("")}>
						/
					</button>
					{path
						.split("/")
						.filter(Boolean)
						.map((part, index, parts) => (
							<span key={index}>
								<button disabled={disabled} onClick={() => browse(parts.slice(0, index + 1).join("/"))}>
									{part}
								</button>{" "}
								/{" "}
							</span>
						))}
					{active && <span>{active.split("/").at(-1)}</span>}
				</nav>
				<details className='file-actions'>
					<summary>New file</summary>
					<label>
						New file path
						<input
							value={newPath}
							onChange={(event) => setNewPath(event.target.value)}
							disabled={disabled}
						/>
					</label>
					<button
						disabled={disabled || !baseHead || !newPath}
						onClick={() =>
							void run(async () => {
								if (!filePathSchema.safeParse(newPath).success || Object.hasOwn(drafts, newPath))
									throw new Error("Choose a new, valid file path.");
								const parts = newPath.split("/");
								let directory = "";
								for (const [index, part] of parts.entries()) {
									const value = await loadTree(directory);
									if (value.head !== baseHead)
										throw new Error("The branch changed. Discard drafts to reload it.");
									if (value.truncated)
										throw new Error("Directory is too large to verify a new file path.");
									const entry = value.entries.find((entry) => entry.name === part);
									if (!entry) break;
									if (index === parts.length - 1 || entry.kind !== "directory")
										throw new Error("That path already exists. Open it from the file list.");
									directory = entry.path;
								}
								setDrafts((current) => ({ ...current, [newPath]: { content: "" } }));
								setActive(newPath);
								setHistory(undefined);
								setNewPath("");
							})
						}
					>
						Create file
					</button>
				</details>
			</div>
			{error && (
				<p className='error' role='alert'>
					{error}
				</p>
			)}
			{notice && <p role='status'>{notice}</p>}
			{loading && <p role='status'>Loading files…</p>}
			{!tree && !loading && (
				<button
					onClick={() => {
						setLoading(true);
						setError("");
						setRevision((value) => value + 1);
					}}
				>
					Retry loading files
				</button>
			)}
			<div className={active && !history ? "repository-layout has-file" : "repository-layout"}>
				{active && !history && (
					<aside className='repository-sidebar' aria-label='File tree'>
						<h3>Files</h3>
						<RepositoryFileTree
							key={revision}
							initial={path === "" ? tree : undefined}
							load={loadTree}
							open={(file) => run(() => open(file))}
							disabled={disabled}
							active={active}
						/>
					</aside>
				)}
				<div className='repository-main'>
					{!history && Object.keys(drafts).length > 0 && (
						<>
							<div className='editor-tabs' role='tablist' aria-label='Editor tabs'>
								{Object.entries(drafts).map(([file, value], index) => (
									<button
										key={file}
										id={`${editorId}-tab-${index}`}
										role='tab'
										aria-selected={active === file}
										aria-controls={`${editorId}-panel`}
										disabled={disabled}
										onClick={() => setActive(file)}
									>
										<FileIcon name={file} />
										{file}
										{value.original !== value.content ? " *" : ""}
									</button>
								))}
							</div>
						</>
					)}
					{active && !history ? (
						<div className='editor-pane'>
							<section
								id={`${editorId}-panel`}
								role='tabpanel'
								aria-labelledby={`${editorId}-tab-${Object.keys(drafts).indexOf(active)}`}
							>
								{header}
								{draft && (
									<div className='repository-code'>
										<Editor
											key={active}
											path={active}
											content={draft.content}
											change={(content) =>
												setDrafts((current) => ({
													...current,
													[active]: { ...current[active]!, content },
												}))
											}
										/>
									</div>
								)}
							</section>
						</div>
					) : (
						<>
							{header}
							{history ? (
								<section className='commit-history' aria-label='Commit history'>
									<h2>{branch}</h2>
									{history.commits.map((commit) => (
										<article key={commit.sha}>
											<strong>{commit.subject}</strong>
											<p>
												{commit.author} · <ChangedAt date={commit.date} />
											</p>
											<code>{commit.sha.slice(0, 7)}</code>
										</article>
									))}
									{!history.commits.length && <p>No commits yet.</p>}
									{history.hasMore && (
										<button disabled={disabled} onClick={() => void run(() => showHistory(true))}>
											Load more commits
										</button>
									)}
								</section>
							) : (
								<>
									{path && (
										<div className='parent-row'>
											<button
												disabled={disabled}
												onClick={() => browse(path.split("/").slice(0, -1).join("/"))}
											>
												Parent directory
											</button>
										</div>
									)}
									<table className='repository-files' aria-label='Repository files'>
										<tbody>
											{(showAll ? entries : entries.slice(0, 10)).map((entry) => (
												<tr key={entry.path}>
													<td>
														<button
															aria-label={entry.name}
															disabled={disabled}
															onClick={() =>
																entry.kind === "directory"
																	? browse(entry.path)
																	: void run(() => open(entry.path))
															}
														>
															<FileIcon
																name={entry.name}
																directory={entry.kind === "directory"}
															/>
															<span>{entry.name}</span>
														</button>
													</td>
													<td className='file-commit'>{entry.lastCommit?.subject ?? "—"}</td>
													<td>
														<ChangedAt date={entry.lastCommit?.date} />
													</td>
												</tr>
											))}
										</tbody>
									</table>
									{!entries.length && !loading && (
										<p className='repository-empty'>This directory is empty.</p>
									)}
									{entries.length > 10 && (
										<button className='show-files' onClick={() => setShowAll(!showAll)}>
											{showAll ? "Show fewer files" : `Show all ${entries.length} files`}
										</button>
									)}
									{tree?.truncated && (
										<p className='notice'>
											Directory exceeds the 1,000-entry limit. Some files are not shown.
										</p>
									)}
								</>
							)}
						</>
					)}
				</div>
			</div>
			{!active && !history && (readme || readmeError) && (
				<section className='repository-readme' aria-label='README'>
					<div className='readme-heading'>
						<FileIcon name='README.md' />
						<strong>README</strong>
					</div>
					{readme ? (
						<Readme content={drafts[readme.path]?.content ?? readme.content} />
					) : (
						<p>{readmeError}</p>
					)}
				</section>
			)}
			{dirty && (
				<form
					className='commit-drafts'
					onSubmit={(event) => {
						event.preventDefault();
						void run(async () => {
							const files = changed.map(([file, value]) => ({ path: file, content: value.content }));
							const result = await api.read(`${root}/commit`, repositoryCommitResultSchema, "POST", {
								branch,
								expectedHead: baseHead,
								message,
								files,
							});
							setBaseHead(result.head);
							setDrafts((current) =>
								Object.fromEntries(
									Object.entries(current).map(([file, value]) => {
										const sent = files.find((entry) => entry.path === file);
										return [file, sent ? { ...value, original: sent.content } : value];
									}),
								),
							);
							setMessage("");
							setNotice(
								`Committed ${files.length} ${files.length === 1 ? "file" : "files"} to ${branch}.`,
							);
							setLoading(true);
							setRevision((value) => value + 1);
						});
					}}
				>
					<p>
						{changed.length} changed {changed.length === 1 ? "file" : "files"} · Drafts stay in this browser
						until committed to <strong>{branch}</strong>.
					</p>
					<label>
						Commit message
						<input
							value={message}
							maxLength={4096}
							onChange={(event) => setMessage(event.target.value)}
							disabled={busy}
							required
						/>
					</label>
					<div className='toolbar'>
						<button className='primary' type='submit' disabled={disabled || !message.trim()}>
							Commit
						</button>
						<button
							type='button'
							disabled={disabled}
							onClick={() => {
								setDrafts({});
								setActive("");
								setBaseHead("");
								setError("");
								setHistory(undefined);
								setLoading(true);
								setTree(undefined);
								setRevision((value) => value + 1);
							}}
						>
							Discard all drafts
						</button>
					</div>
				</form>
			)}
		</div>
	);
};

export const RepositoryBrowser = ({
	projectId,
	api,
	dirtyChange,
}: {
	projectId: string;
	api: IWorkspaceApi;
	dirtyChange: (branch: string, dirty: boolean) => void;
}) => {
	const [branches, setBranches] = useState<RepositoryBranch[]>([]);
	const [branch, setBranch] = useState("");
	const [visited, setVisited] = useState<string[]>([]);
	const [error, setError] = useState("");
	const [revision, setRevision] = useState(0);
	const root = `projects/${projectId}/repository`;
	useEffect(() => {
		let cancelled = false;
		void api
			.read(`${root}/branches`, repositoryBranchesSchema)
			.then((values) => {
				if (cancelled) return;
				setBranches(values);
				setError("");
				const initial = values.find((value) => value.name === "main")?.name ?? values.at(0)?.name ?? "";
				setBranch(initial);
				setVisited(initial ? [initial] : []);
			})
			.catch(() => {
				if (!cancelled) setError("Branch list unavailable.");
			});
		return () => {
			cancelled = true;
		};
	}, [api, root, revision]);
	return (
		<div className='repository-browser'>
			{error && (
				<p role='alert'>
					{error} <button onClick={() => setRevision((value) => value + 1)}>Retry branches</button>
				</p>
			)}
			{!branches.length && !error && <p>No branches yet.</p>}
			{visited.map((value) => (
				<div key={value} hidden={branch !== value}>
					<BranchBrowser
						root={root}
						branch={value}
						api={api}
						dirtyChange={dirtyChange}
						branchControl={
							<label className='branch-picker'>
								<span aria-hidden='true'>⑂</span>
								<select
									aria-label='Branch'
									value={branch}
									disabled={!branches.length}
									onChange={(event) => {
										const value = event.target.value;
										setBranch(value);
										setVisited((current) =>
											current.includes(value) ? current : [...current, value],
										);
									}}
								>
									{branches.map((value) => (
										<option key={value.name} value={value.name}>
											{value.name}
										</option>
									))}
								</select>
							</label>
						}
					/>
				</div>
			))}
		</div>
	);
};
