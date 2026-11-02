import {
	workspaceSchema,
	workspacesSchema,
	workspaceTreeSchema,
	workspaceFileSchema,
	workspaceDiffSchema,
} from "@homelab-paas/forge-contracts";
import type { Project, Workspace, WorkspaceFile, WorkspaceTree, WorkspaceDiff } from "@homelab-paas/forge-contracts";
import { useEffect, useState } from "react";

import type { IWorkspaceApi } from "../api/workspace-api.ts";
import { Changes } from "./changes.tsx";
import { Editor } from "./editor.tsx";
import { PullRequests } from "./pull-requests.tsx";
import { WorkspaceTerminal } from "./terminal.tsx";

interface Draft {
	file: WorkspaceFile;
	content: string;
	server?: WorkspaceFile;
	generation: number;
}

export const Workbench = ({ project, api, leave }: { project: Project; api: IWorkspaceApi; leave: () => void }) => {
	const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
	const [workspace, setWorkspace] = useState<Workspace>();
	const [name, setName] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(true);
	const [tree, setTree] = useState<WorkspaceTree>();
	const [drafts, setDrafts] = useState<Record<string, Draft>>({});
	const [active, setActive] = useState("");
	const [fileName, setFileName] = useState("");
	const [comparison, setComparison] = useState<{ id: string; value: WorkspaceDiff }>();
	const diff = comparison?.id === workspace?.id ? comparison?.value : undefined;
	const dirty = Object.values(drafts).some((draft) => draft.content !== draft.file.content);
	const run = async (action: () => Promise<void>) => {
		setBusy(true);
		setError("");
		try {
			await action();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Operation failed");
		} finally {
			setBusy(false);
		}
	};
	const list = async () => {
		setWorkspaces(await api.read(`projects/${project.id}/workspaces`, workspacesSchema));
	};
	useEffect(() => {
		void api
			.read(`projects/${project.id}/workspaces`, workspacesSchema)
			.then(setWorkspaces)
			.catch(() => setError("Workspace list unavailable. Refresh workspaces to retry."))
			.finally(() => setBusy(false));
	}, [project.id, api]);
	useEffect(() => {
		const guard = (event: BeforeUnloadEvent) => {
			if (dirty) event.preventDefault();
		};
		window.addEventListener("beforeunload", guard);
		return () => window.removeEventListener("beforeunload", guard);
	}, [dirty]);
	const navigate = (action: () => void) => {
		if (dirty) {
			setError("Unsaved edits remain. Save files or explicitly discard drafts before leaving.");
			return;
		}
		action();
	};
	const directory = async (path: string) => {
		if (workspace)
			setTree(
				await api.read(`workspaces/${workspace.id}/tree?path=${encodeURIComponent(path)}`, workspaceTreeSchema),
			);
	};
	const refresh = async (value: Workspace) => {
		setTree(undefined);
		setComparison(undefined);
		setWorkspace(value);
		if (value.status !== "ready") {
			return;
		}
		setTree(await api.read(`workspaces/${value.id}/tree?path=`, workspaceTreeSchema));
		setComparison({ id: value.id, value: await api.read(`workspaces/${value.id}/diff`, workspaceDiffSchema) });
	};
	const open = async (path: string) => {
		if (!workspace) return;
		if (!drafts[path]) {
			const file = await api.read(
				`workspaces/${workspace.id}/file?path=${encodeURIComponent(path)}`,
				workspaceFileSchema,
			);
			setDrafts((current) => ({ ...current, [path]: { file, content: file.content, generation: 0 } }));
		}
		setActive(path);
	};
	const draft = drafts[active];
	const save = async () => {
		if (!workspace || !draft) return;
		const file = await api.read(`workspaces/${workspace.id}/file`, workspaceFileSchema, "PUT", {
			path: active,
			content: draft.content,
			version: draft.file.version,
		});
		setDrafts((current) => ({ ...current, [active]: { ...current[active]!, file } }));
		setComparison({
			id: workspace.id,
			value: await api.read(`workspaces/${workspace.id}/diff`, workspaceDiffSchema),
		});
	};
	return (
		<section className='workbench' aria-label='Project workspace'>
			<div className='toolbar'>
				<button disabled={busy} onClick={() => navigate(leave)}>
					Back to projects
				</button>
				<h2>{project.name}</h2>
			</div>
			{error && (
				<p role='alert' className='error'>
					{error}
				</p>
			)}
			<div className='toolbar'>
				<label>
					Workspace name
					<input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
				</label>
				<button
					disabled={busy || !name.trim()}
					onClick={() =>
						void run(async () => {
							await api.read(`projects/${project.id}/workspaces`, workspaceSchema, "POST", { name });
							setName("");
							await list();
						})
					}
				>
					Create workspace
				</button>
				<button disabled={busy} onClick={() => void run(list)}>
					Refresh workspaces
				</button>
			</div>
			<nav className='toolbar' aria-label='Workspaces'>
				{workspaces.map((value) => (
					<div key={value.id}>
						<button
							disabled={busy}
							onClick={() =>
								navigate(() => {
									setDrafts({});
									setActive("");
									void run(() => refresh(value));
								})
							}
							aria-label={`Open ${value.name}`}
						>
							{value.name} · {value.status}
						</button>
						{value.status === "failed" && (
							<button
								disabled={busy}
								onClick={() =>
									void run(async () => {
										await api.read(`workspaces/${value.id}/retry`, workspaceSchema, "POST", {});
										await list();
									})
								}
							>
								Retry {value.name}
							</button>
						)}
					</div>
				))}
			</nav>
			{workspace && (
				<>
					<p className='branch'>
						{workspace.branch} · {workspace.status}
					</p>
					<button
						disabled={busy || workspace.status === "archived"}
						onClick={() =>
							navigate(
								() =>
									void run(async () => {
										await refresh(
											await api.read(`workspaces/${workspace.id}`, workspaceSchema, "DELETE"),
										);
										await list();
									}),
							)
						}
					>
						Archive workspace (preserve files)
					</button>
					{dirty && (
						<button
							disabled={busy}
							onClick={() => {
								setDrafts({});
								setActive("");
								setError("");
							}}
						>
							Discard all drafts
						</button>
					)}
					{workspace.status === "ready" && (
						<>
							<div className='ide-grid'>
								<aside aria-label='File tree'>
									<h3>Files</h3>
									<button disabled={busy} onClick={() => void run(() => directory(""))}>
										Root
									</button>
									{tree && (
										<>
											<p>{tree.path || "/"}</p>
											{tree.path && (
												<button
													onClick={() =>
														void run(() =>
															directory(tree.path.split("/").slice(0, -1).join("/")),
														)
													}
												>
													Parent directory
												</button>
											)}
											{tree.entries.map((entry) => (
												<button
													key={entry.path}
													className='tree-entry'
													disabled={busy}
													onClick={() =>
														void run(() =>
															entry.kind === "directory"
																? directory(entry.path)
																: open(entry.path),
														)
													}
												>
													{entry.kind === "directory" ? `${entry.name}/` : entry.name}
												</button>
											))}
											{tree.truncated && <p>File list truncated</p>}
										</>
									)}
									<label>
										New file path
										<input value={fileName} onChange={(event) => setFileName(event.target.value)} />
									</label>
									<button
										disabled={busy || !fileName}
										onClick={() =>
											void run(async () => {
												const file = await api.read(
													`workspaces/${workspace.id}/file`,
													workspaceFileSchema,
													"POST",
													{ path: fileName, content: "" },
												);
												setDrafts((current) => ({
													...current,
													[file.path]: { file, content: file.content, generation: 0 },
												}));
												setActive(file.path);
												setFileName("");
												await directory(tree?.path ?? "");
											})
										}
									>
										Create file
									</button>
								</aside>
								<div className='editor-pane'>
									<nav className='toolbar' aria-label='Editor tabs'>
										{Object.entries(drafts).map(([path, value]) => (
											<button
												key={path}
												aria-pressed={active === path}
												onClick={() => setActive(path)}
											>
												{path}
												{value.content !== value.file.content ? " *" : ""}
											</button>
										))}
									</nav>
									{draft ? (
										<>
											<Editor
												key={`${active}:${draft.generation}`}
												path={active}
												content={draft.content}
												change={(content) =>
													setDrafts((current) => ({
														...current,
														[active]: { ...current[active]!, content },
													}))
												}
											/>
											<div className='toolbar'>
												<button
													disabled={busy || draft.content === draft.file.content}
													onClick={() => void run(save)}
												>
													Save file
												</button>
												<span>
													{draft.content === draft.file.content ? "Saved" : "Unsaved changes"}
												</span>
												<button
													disabled={busy}
													onClick={() =>
														void run(async () => {
															const server = await api.read(
																`workspaces/${workspace.id}/file?path=${encodeURIComponent(active)}`,
																workspaceFileSchema,
															);
															setDrafts((current) => ({
																...current,
																[active]: { ...current[active]!, server },
															}));
														})
													}
												>
													Compare server version
												</button>
											</div>
											{draft.server && (
												<section aria-label='Conflict recovery'>
													<h3>Server version</h3>
													<pre>{draft.server.content}</pre>
													<p>
														Your draft remains in the editor. Copy it before discarding if
														needed.
													</p>
													<button
														onClick={() =>
															setDrafts((current) => ({
																...current,
																[active]: {
																	file: draft.server!,
																	content: draft.server!.content,
																	generation: draft.generation + 1,
																},
															}))
														}
													>
														Use server version and discard draft
													</button>
												</section>
											)}
										</>
									) : (
										<p>Open a file to edit.</p>
									)}
								</div>
							</div>
							{diff && (
								<Changes
									id={workspace.id}
									key={workspace.id}
									api={api}
									value={diff}
									update={(value) =>
										setComparison((current) =>
											current?.id === workspace.id ? { id: workspace.id, value } : current,
										)
									}
								/>
							)}
							<WorkspaceTerminal id={workspace.id} key={`terminal:${workspace.id}`} api={api} />
						</>
					)}
				</>
			)}
			<PullRequests projectId={project.id} workspace={workspace} api={api} />
		</section>
	);
};
