import {
	workspaceSchema,
	workspacesSchema,
	workspaceTreeSchema,
	workspaceFileSchema,
	workspaceDiffSchema,
} from "@homelab-paas/forge-contracts";
import type { Project, Workspace, WorkspaceFile, WorkspaceTree, WorkspaceDiff } from "@homelab-paas/forge-contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import type { IWorkspaceApi } from "../api/workspace-api.ts";
import { Changes } from "./changes.tsx";
import { Editor } from "./editor.tsx";
import { PullRequests } from "./pull-requests.tsx";
import { RepositoryBrowser } from "./repository-browser.tsx";
import { WorkspaceTerminal } from "./terminal.tsx";

interface Draft {
	file: WorkspaceFile;
	content: string;
	server?: WorkspaceFile;
	generation: number;
}

export const Workbench = ({ project, api, leave }: { project: Project; api: IWorkspaceApi; leave: () => void }) => {
	const [workspace, setWorkspace] = useState<Workspace>();
	const [tab, setTab] = useState("Code");
	const preparing = useRef<Promise<Workspace> | undefined>(undefined);
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
	const prepare = useCallback(async (): Promise<Workspace> => {
		const values = await api.read(`projects/${project.id}/workspaces`, workspacesSchema);
		const existing =
			values.find((value) => value.name === "Project files" && value.status !== "archived")
			?? values.find((value) => value.status !== "archived");
		return (
			existing
			?? api.read(`projects/${project.id}/workspaces`, workspaceSchema, "POST", { name: "Project files" })
		);
	}, [api, project.id]);
	const refresh = useCallback(
		async (value: Workspace, cancelled: () => boolean = () => false): Promise<void> => {
			setTree(undefined);
			setComparison(undefined);
			setWorkspace(value);
			if (value.status !== "ready") {
				return;
			}
			const tree = await api.read(`workspaces/${value.id}/tree?path=`, workspaceTreeSchema);
			const valueDiff = await api.read(`workspaces/${value.id}/diff`, workspaceDiffSchema);
			if (cancelled()) return;
			setTree(tree);
			setComparison({ id: value.id, value: valueDiff });
		},
		[api],
	);
	useEffect(() => {
		let cancelled = false;
		preparing.current ??= prepare();
		void preparing.current
			.then(async (value) => {
				if (!cancelled) await refresh(value, () => cancelled);
			})
			.catch(() => {
				if (!cancelled) setError("Project files unavailable. Retry opening files.");
			})
			.finally(() => {
				if (!cancelled) setBusy(false);
			});
		return () => {
			cancelled = true;
		};
	}, [prepare, refresh]);
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
		<section className='workbench' aria-label='Project'>
			<div className='project-heading'>
				<button disabled={busy} onClick={() => navigate(leave)}>
					Projects
				</button>
				<span aria-hidden='true'>/</span>
				<h1>{project.name}</h1>
			</div>
			<div className='project-tabs' role='tablist' aria-label='Project sections'>
				{["Code", "Tasks", "Agents", "Pipelines", "Terminals"].map((name) => (
					<button
						key={name}
						id={`tab-${name}`}
						role='tab'
						aria-selected={tab === name}
						aria-controls={`panel-${name}`}
						onClick={() => setTab(name)}
					>
						{name}
					</button>
				))}
			</div>
			{["Tasks", "Agents", "Pipelines"].map((name) => (
				<section
					key={name}
					id={`panel-${name}`}
					role='tabpanel'
					aria-labelledby={`tab-${name}`}
					hidden={tab !== name}
					className='empty feature-empty'
				>
					<h2>{name}</h2>
					<p>{name} are not available yet.</p>
				</section>
			))}
			{error && (
				<p role='alert' className='error'>
					{error}
				</p>
			)}
			{busy && !workspace && <p role='status'>Opening project files…</p>}
			{!busy && (!workspace || workspace.status !== "ready" || !tree) && (
				<button
					onClick={() =>
						void run(async () => {
							const value =
								workspace?.status === "failed"
									? await api.read(`workspaces/${workspace.id}/retry`, workspaceSchema, "POST", {})
									: await prepare();
							await refresh(value);
						})
					}
				>
					Retry opening files
				</button>
			)}
			{workspace && (
				<>
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
							<section id='panel-Code' role='tabpanel' aria-labelledby='tab-Code' hidden={tab !== "Code"}>
								<RepositoryBrowser
									projectId={project.id}
									workspace={workspace}
									api={api}
									tree={tree}
									active={active}
									busy={busy}
									directory={directory}
									open={open}
									back={() => setActive("")}
									fileActions={
										<>
											<label>
												New file path
												<input
													value={fileName}
													onChange={(event) => setFileName(event.target.value)}
												/>
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
										</>
									}
								>
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
														{draft.content === draft.file.content
															? "Saved"
															: "Unsaved changes"}
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
															Your draft remains in the editor. Copy it before discarding
															if needed.
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
										) : null}
									</div>
								</RepositoryBrowser>
								<details className='review-panel'>
									<summary>Changes</summary>
									{diff && (
										<Changes
											id={workspace.id}
											key={workspace.id}
											api={api}
											value={diff}
											update={(value) =>
												setComparison((current) =>
													current?.id === workspace.id
														? { id: workspace.id, value }
														: current,
												)
											}
										/>
									)}
								</details>
								<details className='review-panel'>
									<summary>Pull requests</summary>
									<PullRequests projectId={project.id} workspace={workspace} api={api} />
								</details>
							</section>
							{tab === "Terminals" && (
								<section id='panel-Terminals' role='tabpanel' aria-labelledby='tab-Terminals'>
									<WorkspaceTerminal id={workspace.id} key={`terminal:${workspace.id}`} api={api} />
								</section>
							)}
						</>
					)}
				</>
			)}
		</section>
	);
};
