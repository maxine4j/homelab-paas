import type { UiSecrets } from "@homelab-paas/shared-contracts";
import { useState } from "react";

export const SecretsForm = ({
	snapshot,
	drafts,
	disabled,
	onDraft,
}: {
	snapshot: UiSecrets;
	drafts: Record<string, string>;
	disabled?: boolean;
	onDraft(name: string, value: string | undefined): void;
}) => {
	const [extraName, setExtraName] = useState("");
	const [error, setError] = useState("");
	const variables = [
		...snapshot.variables,
		...Object.keys(drafts)
			.filter((name) => !snapshot.variables.some((variable) => variable.name === name))
			.map((name) => ({ name, configured: false, used: false })),
	];
	const rows = (used: boolean) =>
		variables
			.filter((variable) => variable.used === used)
			.map((variable) => {
				const editing = Object.hasOwn(drafts, variable.name);
				return (
					<div className='secret-row' key={variable.name}>
						<div className='secret-row-heading'>
							<label htmlFor={`secret-${variable.name}`}>
								<code>{variable.name}</code>
							</label>
							<span className={`badge badge-${variable.configured ? "ready" : "warning"}`}>
								{variable.configured ? "Configured" : "Missing"}
							</span>
							{!used && <span className='muted'>Unused</span>}
						</div>
						<label className='secret-edit-toggle'>
							<input
								type='checkbox'
								disabled={disabled}
								checked={editing}
								onChange={(event) => onDraft(variable.name, event.target.checked ? "" : undefined)}
							/>
							{variable.configured ? "Replace saved value" : "Set value"} (a blank field saves an empty
							value)
						</label>
						<input
							id={`secret-${variable.name}`}
							aria-label={`${variable.name} value`}
							type='password'
							autoComplete='new-password'
							maxLength={16384}
							value={editing ? drafts[variable.name] : ""}
							disabled={disabled || !editing}
							placeholder={variable.configured ? "Saved value is never displayed" : "Enter secret value"}
							onChange={(event) => onDraft(variable.name, event.target.value)}
						/>
					</div>
				);
			});
	return (
		<>
			<h2>Descriptor secrets</h2>
			<p>
				Enable Set value or Replace saved value to edit. Unselected values are retained. Saved values stay
				hidden.
			</p>
			{rows(true)}
			{!variables.some((variable) => variable.used) && (
				<p className='muted'>No secret variables declared in the current descriptor.</p>
			)}
			<h2>Extra environment variables</h2>
			<p>
				Prepare secrets for future descriptors. Unused variables are saved but only declared secret variables
				are passed to workloads.
			</p>
			{rows(false)}
			<div className='secret-add'>
				<label>
					Variable name
					<input
						value={extraName}
						disabled={disabled}
						placeholder='NEW_API_TOKEN'
						maxLength={128}
						onChange={(event) => setExtraName(event.target.value)}
					/>
				</label>
				<button
					type='button'
					disabled={disabled}
					onClick={() => {
						if (
							!/^[A-Za-z_][A-Za-z0-9_]*$/.test(extraName)
							|| extraName.startsWith("PAAS_")
							|| variables.some((variable) => variable.name === extraName)
						) {
							setError(
								"Enter a valid, unique environment variable name without the reserved PAAS_ prefix.",
							);
							return;
						}
						onDraft(extraName, "");
						setExtraName("");
						setError("");
					}}
				>
					Add variable
				</button>
			</div>
			{error && <p role='alert'>{error}</p>}
		</>
	);
};
