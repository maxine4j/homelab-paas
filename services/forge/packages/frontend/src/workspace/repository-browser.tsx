import {
	repositoryBranchesSchema,
	repositoryTreeSchema,
	repositoryFileSchema,
	repositoryHistorySchema,
	workspaceFileSchema,
	workspaceTreeSchema,
	type RepositoryBranch,
	type RepositoryTree,
	type RepositoryFile,
	type RepositoryHistory,
	type Workspace,
	type WorkspaceTree,
} from "@homelab-paas/forge-contracts";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import type { IWorkspaceApi } from "../api/workspace-api.ts";
import { Editor } from "./editor.tsx";
import { FileIcon } from "./file-icon.tsx";
import { RepositoryFileTree } from "./repository-file-tree.tsx";

const ChangedAt = ({ date }: { date?: string }) =>
	date ? (
		<time dateTime={date} title={new Date(date).toLocaleString()}>
			{new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
		</time>
	) : (
		<span>Uncommitted</span>
	);

// Render text as React nodes; repository HTML is never inserted into the page.
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

export const RepositoryBrowser = ({
	projectId,
	workspace,
	api,
	tree,
	active,
	busy,
	directory,
	open,
	back,
	fileActions,
	children,
}: {
	projectId: string;
	workspace: Workspace;
	api: IWorkspaceApi;
	tree?: WorkspaceTree;
	active: string;
	busy: boolean;
	directory: (path: string) => Promise<void>;
	open: (path: string) => Promise<void>;
	back: () => void;
	fileActions: ReactNode;
	children: ReactNode;
}) => {
	const [branch, setBranch] = useState("");
	const [branches, setBranches] = useState<RepositoryBranch[]>([]);
	const [branchError, setBranchError] = useState("");
	const [path, setPath] = useState("");
	const [committedTree, setCommittedTree] = useState<RepositoryTree>();
	const [file, setFile] = useState<RepositoryFile>();
	const [readmeResult, setReadmeResult] = useState<{ key: string; file?: RepositoryFile; error?: string }>();
	const [history, setHistory] = useState<RepositoryHistory>();
	const [showAll, setShowAll] = useState(false);
	const [loading, setLoading] = useState(false);
	const [treeLoading, setTreeLoading] = useState(false);
	const [error, setError] = useState("");
	const root = `projects/${projectId}/repository`;
	const selectedBranch = branch || workspace.branch;
	const displayedTree = branch ? committedTree : tree;
	const currentPath = branch ? path : (tree?.path ?? "");
	const selectedFile = branch ? file?.path : active;
	const disabled = busy || loading || treeLoading;
	const entries = [...(displayedTree?.entries ?? [])].sort((a, b) =>
		a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1,
	);
	const readmePath = entries.find(
		(e) => e.kind === "file" && /^readme(?:\.(?:md|markdown|txt))?$/iu.test(e.name),
	)?.path;
	const readmeKey = `${selectedBranch}:${readmePath ?? ""}`;
	const readme = readmeResult?.key === readmeKey ? readmeResult.file : undefined;
	const readmeError = readmeResult?.key === readmeKey ? readmeResult.error : undefined;
	const loadBranches = () => {
		setBranchError("");
		return api
			.read(`${root}/branches`, repositoryBranchesSchema)
			.then(setBranches)
			.catch(() => setBranchError("Branch list unavailable."));
	};
	useEffect(() => {
		let cancelled = false;
		void api
			.read(`${root}/branches`, repositoryBranchesSchema)
			.then((value) => {
				if (!cancelled) setBranches(value);
			})
			.catch(() => {
				if (!cancelled) setBranchError("Branch list unavailable.");
			});
		return () => {
			cancelled = true;
		};
	}, [api, root]);
	useEffect(() => {
		if (!branch) return;
		let cancelled = false;
		void api
			.read(
				`${root}/tree?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`,
				repositoryTreeSchema,
			)
			.then((value) => {
				if (!cancelled) setCommittedTree(value);
			})
			.catch((failure) => {
				if (!cancelled) setError(failure instanceof Error ? failure.message : "Files unavailable");
			})
			.finally(() => {
				if (!cancelled) setTreeLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [api, root, branch, path]);
	useEffect(() => {
		let cancelled = false;
		if (readmePath) {
			const request = branch
				? api.read(
						`${root}/file?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(readmePath)}`,
						repositoryFileSchema,
					)
				: api.read(
						`workspaces/${workspace.id}/file?path=${encodeURIComponent(readmePath)}`,
						workspaceFileSchema,
					);
			void request
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
		}
		return () => {
			cancelled = true;
		};
	}, [api, root, branch, workspace.id, readmePath, readmeKey, tree]);
	const run = async (action: () => Promise<void>) => {
		setLoading(true);
		setError("");
		try {
			await action();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Operation failed");
		} finally {
			setLoading(false);
		}
	};
	const browse = async (next: string) => {
		if (branch) {
			if (path !== next) {
				setTreeLoading(true);
				setCommittedTree(undefined);
			}
			setPath(next);
			setFile(undefined);
		} else {
			await directory(next);
			back();
		}
		setHistory(undefined);
		setShowAll(false);
	};
	const select = async (entry: { path: string; kind: "file" | "directory" }) => {
		if (entry.kind === "directory") return browse(entry.path);
		if (branch)
			setFile(
				await api.read(
					`${root}/file?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(entry.path)}`,
					repositoryFileSchema,
				),
			);
		else await open(entry.path);
		setHistory(undefined);
	};
	const showHistory = async (more = false) => {
		const value = await api.read(
			`${root}/history?branch=${encodeURIComponent(selectedBranch)}&offset=${more ? (history?.commits.length ?? 0) : 0}`,
			repositoryHistorySchema,
		);
		if (more && history && value.head !== history.head)
			throw new Error("Branch changed. Reopen commit history to refresh.");
		setHistory(more && history ? { ...value, commits: [...history.commits, ...value.commits] } : value);
	};
	const backToFiles = () => {
		back();
		setFile(undefined);
		setHistory(undefined);
	};
	const loadTree = useCallback(
		(directory: string): Promise<WorkspaceTree | RepositoryTree> =>
			branch
				? api.read(
						`${root}/tree?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(directory)}`,
						repositoryTreeSchema,
					)
				: api.read(
						`workspaces/${workspace.id}/tree?path=${encodeURIComponent(directory)}`,
						workspaceTreeSchema,
					),
		[api, root, branch, workspace.id],
	);

	return (
		<div className='repository-browser'>
			<div className='repository-toolbar'>
				<label className='branch-picker'>
					<span aria-hidden='true'>⑂</span>
					<select
						aria-label='Branch'
						disabled={disabled}
						value={branch}
						onChange={(event) => {
							setBranch(event.target.value);
							setPath("");
							setFile(undefined);
							setHistory(undefined);
							setShowAll(false);
							setTreeLoading(Boolean(event.target.value));
							setCommittedTree(undefined);
							setError("");
						}}
					>
						<option value=''>Working changes</option>
						{branches
							.filter((b) => !b.name.startsWith("forge/workspace/"))
							.map((b) => (
								<option key={b.name} value={b.name}>
									{b.name}
								</option>
							))}
					</select>
				</label>
				<nav aria-label='File path'>
					<button disabled={disabled} onClick={() => void run(() => browse(""))}>
						Root
					</button>
					{currentPath
						.split("/")
						.filter(Boolean)
						.map((part, index, parts) => (
							<span key={index}>
								{" "}
								/{" "}
								<button
									disabled={disabled}
									onClick={() => void run(() => browse(parts.slice(0, index + 1).join("/")))}
								>
									{part}
								</button>
							</span>
						))}
					{selectedFile && <span> / {selectedFile.split("/").at(-1)}</span>}
				</nav>
				{!branch && (
					<details className='file-actions'>
						<summary>New file</summary>
						{fileActions}
					</details>
				)}
			</div>
			{branchError && (
				<p>
					{branchError} <button onClick={() => void loadBranches()}>Retry branches</button>
				</p>
			)}
			{error && (
				<p className='error' role='alert'>
					{error}
				</p>
			)}
			{treeLoading && <p role='status'>Loading files…</p>}
			<div className={selectedFile && !history ? "repository-layout has-file" : "repository-layout"}>
				{selectedFile && !history && (
					<aside className='repository-sidebar' aria-label='File tree'>
						<h3>Files</h3>
						<RepositoryFileTree
							key={selectedBranch}
							initial={currentPath === "" ? displayedTree : undefined}
							load={loadTree}
							open={(path) => run(() => select({ path, kind: "file" }))}
							disabled={disabled}
							active={selectedFile}
						/>
					</aside>
				)}
				<div className='repository-main'>
					<div className='file-list-header'>
						<span>
							{history
								? "Commits"
								: selectedFile
									? selectedFile.split("/").at(-1)
									: currentPath || "Files"}
						</span>
						<div>
							{(selectedFile || history) && (
								<button disabled={disabled} onClick={backToFiles}>
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
					{history ? (
						<section className='commit-history' aria-label='Commit history'>
							<h2>{branch || "Working changes"}</h2>
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
					) : selectedFile ? (
						<div className='repository-code'>
							{branch && file ? (
								<>
									<p className='code-caption'>{branch} · Read-only</p>
									<Editor
										key={`${branch}:${file.path}`}
										path={file.path}
										content={file.content}
										change={() => {}}
										readOnly
									/>
								</>
							) : (
								children
							)}
						</div>
					) : (
						<>
							{currentPath && (
								<div className='parent-row'>
									<button
										disabled={disabled}
										onClick={() =>
											void run(() => browse(currentPath.split("/").slice(0, -1).join("/")))
										}
									>
										Parent directory
									</button>
								</div>
							)}
							<table className='repository-files' aria-label='Repository files'>
								<tbody>
									{(showAll ? entries : entries.slice(0, 10)).map((entry) => {
										const commit = "lastCommit" in entry ? entry.lastCommit : undefined;
										const date = "lastChangedAt" in entry ? entry.lastChangedAt : commit?.date;
										return (
											<tr key={entry.path}>
												<td>
													<button
														aria-label={entry.name}
														disabled={disabled}
														onClick={() => void run(() => select(entry))}
													>
														<FileIcon
															name={entry.name}
															directory={entry.kind === "directory"}
														/>
														<span>{entry.name}</span>
													</button>
												</td>
												<td className='file-commit'>{commit?.subject ?? "Working tree"}</td>
												<td>
													<ChangedAt date={date} />
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
							{!entries.length && !treeLoading && (
								<p className='repository-empty'>This directory is empty.</p>
							)}
							{entries.length > 10 && (
								<button className='show-files' onClick={() => setShowAll(!showAll)}>
									{showAll ? "Show fewer files" : `Show all ${entries.length} files`}
								</button>
							)}
							{displayedTree?.truncated && (
								<p className='notice'>
									Directory exceeds the 1,000-entry limit. Some files are not shown.
								</p>
							)}
						</>
					)}
				</div>
			</div>
			{!selectedFile && !history && (readme || readmeError) && (
				<section className='repository-readme' aria-label='README'>
					<div className='readme-heading'>
						<FileIcon name='README.md' />
						<strong>README</strong>
					</div>
					{readme ? <Readme content={readme.content} /> : <p>{readmeError}</p>}
				</section>
			)}
		</div>
	);
};
