import { workspaceSchema, workspacesSchema, type Project, type Workspace } from "@homelab-paas/forge-contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { AgentChat } from "../agents/agent-chat.tsx";
import type { IWorkspaceApi } from "../api/workspace-api.ts";
import { TaskBoard } from "../tasks/task-board.tsx";
import { RepositoryBrowser } from "./repository-browser.tsx";
import { WorkspaceTerminal } from "./terminal.tsx";

const ProjectTerminal = ({ projectId, api }: { projectId: string; api: IWorkspaceApi }) => {
	const [workspace, setWorkspace] = useState<Workspace>();
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const preparing = useRef<Promise<Workspace> | undefined>(undefined);
	const prepare = useCallback(async () => {
		const values = await api.read(`projects/${projectId}/workspaces`, workspacesSchema);
		return (
			values.find((value) => value.name === "Project files" && value.status !== "archived")
			?? values.find((value) => value.status !== "archived")
			?? api.read(`projects/${projectId}/workspaces`, workspaceSchema, "POST", { name: "Project files" })
		);
	}, [api, projectId]);
	useEffect(() => {
		let cancelled = false;
		preparing.current ??= prepare();
		void preparing.current
			.then((value) => {
				if (!cancelled) setWorkspace(value);
			})
			.catch(() => {
				if (!cancelled) setError("Terminal files unavailable.");
			});
		return () => {
			cancelled = true;
		};
	}, [prepare]);
	if (workspace?.status === "ready") return <WorkspaceTerminal id={workspace.id} api={api} />;
	return (
		<section>
			{error && <p role='alert'>{error}</p>}
			{workspace?.status === "failed" || error ? (
				<button
					disabled={busy}
					onClick={() => {
						setBusy(true);
						setError("");
						void (
							workspace?.status === "failed"
								? api.read(`workspaces/${workspace.id}/retry`, workspaceSchema, "POST", {})
								: prepare()
						)
							.then(setWorkspace)
							.catch(() => setError("Terminal files unavailable."))
							.finally(() => setBusy(false));
					}}
				>
					Retry opening files
				</button>
			) : (
				<p role='status'>Preparing terminal files…</p>
			)}
		</section>
	);
};

export const Workbench = ({ project, api, leave }: { project: Project; api: IWorkspaceApi; leave: () => void }) => {
	const [tab, setTab] = useState("Code");
	const [dirtyBranches, setDirtyBranches] = useState<Record<string, boolean>>({});
	const [error, setError] = useState("");
	const [terminalOpened, setTerminalOpened] = useState(false);
	const [tasksOpened, setTasksOpened] = useState(false);
	const [agentsOpened, setAgentsOpened] = useState(false);
	const dirty = Object.values(dirtyBranches).some(Boolean);
	const dirtyChange = useCallback((branch: string, value: boolean) => {
		setDirtyBranches((current) => (current[branch] === value ? current : { ...current, [branch]: value }));
	}, []);
	useEffect(() => {
		const guard = (event: BeforeUnloadEvent) => {
			if (dirty) event.preventDefault();
		};
		window.addEventListener("beforeunload", guard);
		return () => window.removeEventListener("beforeunload", guard);
	}, [dirty]);
	return (
		<section className='workbench' aria-label='Project'>
			<div className='project-heading'>
				<button
					onClick={() => {
						if (dirty) setError("Uncommitted drafts remain. Commit or discard them before leaving.");
						else leave();
					}}
				>
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
						onClick={() => {
							setTab(name);
							if (name === "Terminals") setTerminalOpened(true);
							if (name === "Tasks") setTasksOpened(true);
							if (name === "Agents") setAgentsOpened(true);
						}}
					>
						{name}
					</button>
				))}
			</div>
			{error && dirty && (
				<p role='alert' className='error'>
					{error}
				</p>
			)}
			<section id='panel-Code' role='tabpanel' aria-labelledby='tab-Code' hidden={tab !== "Code"}>
				<RepositoryBrowser
					projectId={project.id}
					repositoryName={project.name}
					api={api}
					dirtyChange={dirtyChange}
				/>
			</section>
			<section id='panel-Tasks' role='tabpanel' aria-labelledby='tab-Tasks' hidden={tab !== "Tasks"}>
				{tasksOpened && <TaskBoard projectId={project.id} api={api} />}
			</section>
			<section id='panel-Agents' role='tabpanel' aria-labelledby='tab-Agents' hidden={tab !== "Agents"}>
				{agentsOpened && <AgentChat projectId={project.id} api={api} />}
			</section>
			<section
				id='panel-Pipelines'
				role='tabpanel'
				aria-labelledby='tab-Pipelines'
				hidden={tab !== "Pipelines"}
				className='empty feature-empty'
			>
				<h2>Pipelines</h2>
				<p>Pipelines are not available yet.</p>
			</section>
			<section id='panel-Terminals' role='tabpanel' aria-labelledby='tab-Terminals' hidden={tab !== "Terminals"}>
				{terminalOpened && <ProjectTerminal projectId={project.id} api={api} />}
			</section>
		</section>
	);
};
