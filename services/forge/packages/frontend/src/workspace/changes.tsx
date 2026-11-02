import { workspaceDiffSchema, workspaceSchema } from "@homelab-paas/forge-contracts";
import type { DiffSection, WorkspaceDiff } from "@homelab-paas/forge-contracts";
import { useState } from "react";

import type { IWorkspaceApi } from "../api/workspace-api.ts";

export const Patch = ({ section }: { section: DiffSection }) => (
	<>
		{section.truncated && <p className='notice'>Diff truncated</p>}
		{section.files.length === 0 && <p>No changes</p>}
		<ul>
			{section.files.map((file) => (
				<li key={file.path}>
					{file.path}
					{file.binary ? " · Binary" : ""}
				</li>
			))}
		</ul>
		{section.patch && (
			<pre className='patch'>
				{section.patch.split("\n").map((line, index) => (
					<span
						key={index}
						className={line.startsWith("+") ? "addition" : line.startsWith("-") ? "deletion" : ""}
					>
						{line}
						{"\n"}
					</span>
				))}
			</pre>
		)}
	</>
);

export const Changes = ({
	id,
	api,
	value,
	update,
}: {
	id: string;
	api: IWorkspaceApi;
	value: WorkspaceDiff;
	update: (value: WorkspaceDiff) => void;
}) => {
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const run = async (action: () => Promise<unknown>) => {
		setBusy(true);
		setError("");
		try {
			await action();
			update(await api.read(`workspaces/${id}/diff`, workspaceDiffSchema));
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Changes unavailable");
		} finally {
			setBusy(false);
		}
	};
	return (
		<section aria-label='File changes'>
			<h3>Changes</h3>
			<button disabled={busy} onClick={() => void run(async () => {})}>
				Refresh changes
			</button>
			{error && (
				<p role='alert' className='error'>
					{error}. Refresh changes before retrying.
				</p>
			)}
			{(["branch", "staged", "unstaged", "untracked"] as const).map((kind) => (
				<section key={kind} aria-label={`${kind} changes`}>
					<h4>{kind[0]!.toUpperCase() + kind.slice(1)}</h4>
					<Patch section={value[kind]} />
					{kind !== "branch"
						&& value[kind].files.map((file) => (
							<button
								key={file.path}
								disabled={busy}
								aria-label={`${kind === "staged" ? "Unstage" : "Stage"} ${file.path}`}
								onClick={() =>
									void run(() =>
										api.read(
											`workspaces/${id}/${kind === "staged" ? "unstage" : "stage"}`,
											workspaceSchema,
											"POST",
											{ paths: [file.path] },
										),
									)
								}
							>
								{kind === "staged" ? "Unstage" : "Stage"} {file.path}
							</button>
						))}
				</section>
			))}
			<label>
				Commit message
				<input maxLength={4096} value={message} onChange={(event) => setMessage(event.target.value)} />
			</label>
			<button
				disabled={busy || !message.trim() || value.staged.files.length === 0}
				onClick={() =>
					void run(async () => {
						await api.read(`workspaces/${id}/commit`, workspaceSchema, "POST", {
							message,
							expectedHead: value.head,
						});
						setMessage("");
					})
				}
			>
				Commit staged changes
			</button>
		</section>
	);
};
