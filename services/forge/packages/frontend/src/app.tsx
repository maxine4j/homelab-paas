import type { AccountProvider, AccountStatus, AccountsStatus, Project } from "@homelab-paas/forge-contracts";
import { createProjectSchema } from "@homelab-paas/forge-contracts";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import type { IApiClient } from "./api/api-client.ts";
import { ResourcePoller } from "./api/resource-poller.ts";
import type { IWorkspaceApi } from "./api/workspace-api.ts";
import { Workbench } from "./workspace/workbench.tsx";

const failureMessages = {
	unavailable: "Check the CLI installation and credential-home permissions on the server.",
	"verification-failed": "Check connectivity and account access, then refresh or retry sign-in.",
	"login-failed": "Request a fresh code and check your provider's device-login settings.",
	"connection-lost":
		"Previous sign-in outcome is unknown. Refresh to verify the account, then explicitly cancel or retry.",
};

const AccountCard = ({
	provider,
	status,
	busy,
	action,
}: {
	provider: AccountProvider;
	status?: AccountStatus;
	busy: boolean;
	action: (action: "login" | "retry" | "cancel") => void;
}) => {
	const title = provider === "codex" ? "ChatGPT" : "GitHub";
	return (
		<section className='account-card' aria-label={title}>
			<div className='card-top'>
				<span className='provider-icon' aria-hidden='true'>
					{provider === "codex" ? "✳" : "⑂"}
				</span>
				<div>
					<h3>{title}</h3>
					<p>{provider === "codex" ? "Codex account" : "Repository access"}</p>
				</div>
				<span className={`dot ${status?.account ? "connected" : ""}`} />
			</div>
			{!status ? (
				<p>Checking account…</p>
			) : (
				<>
					<p className='account-name'>{status.account ? status.account.name : "Not signed in"}</p>
					{status.connection === "unavailable" && (
						<p className='notice'>Account connection unavailable. Project access is still available.</p>
					)}
					{status.login.failure && <p className='notice'>{failureMessages[status.login.failure]}</p>}
					{status.login.state === "pending" && (
						<div className='device-code'>
							<span>Enter this one-time code</span>
							<strong>{status.login.userCode}</strong>
							<a href={status.login.verificationUrl} target='_blank' rel='noopener noreferrer'>
								Open verification page <span aria-hidden='true'>↗</span>
							</a>
							<small>Waiting for account verification…</small>
						</div>
					)}
					{status.login.state === "completed" && <p className='success'>Account verified.</p>}
					{status.login.state === "cancelled" && <p>Sign-in cancelled.</p>}
					<div className='account-actions'>
						{status.login.state === "pending" ? (
							<button disabled={busy} onClick={() => action("cancel")}>
								Cancel sign-in
							</button>
						) : (
							<button
								disabled={busy}
								onClick={() =>
									action(
										["failed", "uncertain", "cancelled"].includes(status.login.state)
											? "retry"
											: "login",
									)
								}
							>
								{busy
									? "Working…"
									: ["failed", "uncertain", "cancelled"].includes(status.login.state)
										? "Retry sign-in"
										: status.account
											? "Sign in again"
											: "Sign in"}
							</button>
						)}
						{status.login.state === "uncertain" && (
							<button disabled={busy} onClick={() => action("cancel")}>
								Cancel sign-in
							</button>
						)}
					</div>
				</>
			)}
		</section>
	);
};

export const App = ({ api, workspaceApi }: { api: IApiClient; workspaceApi: IWorkspaceApi }) => {
	const [selected, setSelected] = useState<Project>();
	const [projects, setProjects] = useState<Project[]>();
	const [accounts, setAccounts] = useState<AccountsStatus>();
	const [projectError, setProjectError] = useState("");
	const [accountError, setAccountError] = useState("");
	const [name, setName] = useState("");
	const [source, setSource] = useState("");
	const [projectBusy, setProjectBusy] = useState(false);
	const [accountBusy, setAccountBusy] = useState(false);
	const projectPoller = useRef<ResourcePoller<Project[]> | undefined>(undefined);
	const accountPoller = useRef<ResourcePoller<AccountsStatus> | undefined>(undefined);
	useEffect(() => {
		const project = new ResourcePoller(
			(signal) => api.projects(signal),
			(value) => {
				setProjects(value);
				setProjectError("");
			},
			setProjectError,
		);
		const account = new ResourcePoller(
			(signal) => api.accounts(signal),
			(value) => {
				setAccounts(value);
				setAccountError("");
			},
			setAccountError,
		);
		projectPoller.current = project;
		accountPoller.current = account;
		project.refresh();
		account.refresh();
		return () => {
			project.stop();
			account.stop();
		};
	}, [api]);
	const create = async (event: FormEvent) => {
		event.preventDefault();
		const input = createProjectSchema.safeParse({ name, ...(source.trim() ? { source: source.trim() } : {}) });
		if (!input.success) {
			setProjectError("Enter a project name (up to 120 characters) and a credential-free HTTPS import URL.");
			return;
		}
		setProjectBusy(true);
		await projectPoller.current?.mutate(async (signal) => {
			try {
				const project = await api.create(input.data, signal);
				if (!signal.aborted) {
					setName("");
					setSource("");
				}
				return api.projects(signal).catch(() => [...(projects ?? []), project]);
			} catch (error) {
				const current = await api.projects(signal).catch(() => undefined);
				if (current && !signal.aborted) setProjects(current);
				throw error;
			}
		});
		setProjectBusy(false);
	};
	const retry = async (id: string) => {
		setProjectBusy(true);
		await projectPoller.current?.mutate(async (signal) => {
			const project = await api.retry(id, signal);
			return (projects ?? []).map((item) => (item.id === id ? project : item));
		});
		setProjectBusy(false);
	};
	const accountAction = async (provider: AccountProvider, action: "login" | "retry" | "cancel") => {
		setAccountBusy(true);
		await accountPoller.current?.mutate(async (signal) => {
			const status = await api.account(provider, action, signal);
			const current = accounts ?? (await api.accounts(signal));
			return { ...current, [provider]: status };
		});
		setAccountBusy(false);
	};
	return (
		<div className='shell'>
			<header>
				<a className='brand' href='/' aria-label='Forge home'>
					<span aria-hidden='true'>F</span>forge<span className='brand-tag'>LOCAL WORKSPACE</span>
				</a>
				<span className='private-label'>
					<i /> Private · Single owner
				</span>
			</header>
			<main>
				<div className='intro' hidden={!!selected}>
					<div>
						<p className='eyebrow'>YOUR DEVELOPMENT HOME</p>
						<h1>Make room for your next idea.</h1>
						<p>Create a local Git repository or bring an existing project into Forge.</p>
					</div>
					<span className='intro-mark' aria-hidden='true'>
						⑂
					</span>
				</div>
				{selected && (
					<Workbench
						key={selected.id}
						project={selected}
						api={workspaceApi}
						leave={() => setSelected(undefined)}
					/>
				)}
				<div className='workspace-grid' hidden={!!selected}>
					<section aria-labelledby='projects-heading' className='projects-section'>
						<div className='section-heading'>
							<div>
								<p className='eyebrow'>WORKSPACE</p>
								<h2 id='projects-heading'>
									Projects <span className='count'>{projects?.length ?? "—"}</span>
								</h2>
							</div>
							<button
								className='quiet'
								onClick={() => projectPoller.current?.refresh()}
								disabled={projectBusy}
							>
								Refresh projects
							</button>
						</div>
						{projectError && (
							<p role='alert' className='error'>
								{projectError}
							</p>
						)}
						{!projects ? (
							<div className='empty'>Loading projects…</div>
						) : projects.length === 0 ? (
							<div className='empty'>
								<span aria-hidden='true'>＋</span>
								<h3>No projects yet</h3>
								<p>
									Your repositories will live here.
									<br />
									Create your first project to get started.
								</p>
							</div>
						) : (
							<div className='project-list'>
								{projects.map((project) => (
									<article className='project' key={project.id}>
										<div className='repo-icon' aria-hidden='true'>
											⑂
										</div>
										<div className='project-info'>
											<h3>{project.name}</h3>
											{project.status === "ready" && (
												<button
													aria-label={`Open ${project.name}`}
													disabled={!!selected}
													onClick={() => setSelected(project)}
												>
													Open
												</button>
											)}
											<p>
												Created{" "}
												{new Date(project.createdAt).toLocaleDateString(undefined, {
													month: "short",
													day: "numeric",
													year: "numeric",
												})}
											</p>
										</div>
										<span className={`status ${project.status}`}>
											{project.status === "ready"
												? "Ready"
												: project.status === "creating"
													? "Creating"
													: "Failed"}
										</span>
										{project.status === "failed" && (
											<button
												disabled={projectBusy}
												aria-label={`Retry ${project.name}`}
												onClick={() => void retry(project.id)}
											>
												Retry
											</button>
										)}
									</article>
								))}
							</div>
						)}
						<p className='section-note'>
							Repositories and project data stay on your persistent Forge volume.
						</p>
					</section>
					<section className='create-card' aria-labelledby='create-heading'>
						<p className='eyebrow'>START SOMETHING</p>
						<h2 id='create-heading'>New project</h2>
						<p>A fresh repository, or a new home for existing code.</p>
						<form onSubmit={(event) => void create(event)}>
							<label htmlFor='project-name'>Project name</label>
							<input
								id='project-name'
								value={name}
								onChange={(event) => setName(event.target.value)}
								required
								maxLength={120}
								placeholder='e.g. homelab-dashboard'
								disabled={projectBusy}
							/>
							<label htmlFor='project-source'>
								Import repository <span>(optional)</span>
							</label>
							<input
								id='project-source'
								type='url'
								value={source}
								onChange={(event) => setSource(event.target.value)}
								maxLength={2048}
								placeholder='https://github.com/owner/repo.git'
								disabled={projectBusy}
							/>
							<small>
								Public HTTPS repositories from operator-approved hosts. Leave blank for an empty
								repository.
							</small>
							<button className='primary' disabled={projectBusy} type='submit'>
								{projectBusy ? "Creating project…" : "Create project"}
								<span aria-hidden='true'>↗</span>
							</button>
						</form>
					</section>
				</div>
				<section className='accounts-section' aria-labelledby='accounts-heading'>
					<div className='section-heading'>
						<div>
							<p className='eyebrow'>CONNECTIONS</p>
							<h2 id='accounts-heading'>Your accounts</h2>
						</div>
						<button
							className='quiet'
							disabled={accountBusy}
							onClick={() => accountPoller.current?.refresh()}
						>
							Refresh accounts
						</button>
					</div>
					<p className='accounts-description'>
						Connect ChatGPT and GitHub here. You can manage projects independently.
					</p>
					{accountError && (
						<p role='alert' className='error'>
							{accountError}
						</p>
					)}
					<div className='account-grid'>
						{(["codex", "github"] as const).map((provider) => (
							<AccountCard
								key={provider}
								provider={provider}
								status={accounts?.[provider]}
								busy={accountBusy}
								action={(action) => void accountAction(provider, action)}
							/>
						))}
					</div>
				</section>
				<footer>
					<span className='footer-brand'>forge</span>
					<span>Local code. Your control.</span>
				</footer>
			</main>
		</div>
	);
};
