import type { UiSecrets } from "@homelab-paas/shared-contracts";
import { useState } from "react";

const SecretRow = ({
	variable,
	disabled,
	onSet,
}: {
	variable: UiSecrets["variables"][number];
	disabled?: boolean;
	onSet(name: string, value: string): Promise<void>;
}) => {
	const [value, setValue] = useState("");
	const [error, setError] = useState("");
	const [saving, setSaving] = useState(false);
	const submit = async () => {
		setSaving(true);
		setError("");
		try {
			await onSet(variable.name, value);
			setValue("");
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Unable to set secret.");
		} finally {
			setSaving(false);
		}
	};
	return (
		<form
			className='secret-row'
			onSubmit={(event) => {
				event.preventDefault();
				if (!disabled && !saving) void submit();
			}}
		>
			<div className='secret-row-heading'>
				<label htmlFor={"secret-" + variable.name}>
					<code>{variable.name}</code>
				</label>
				<span
					className={
						"badge badge-" + (!variable.used ? "warning" : variable.configured ? "healthy" : "error")
					}
				>
					{!variable.used ? "Unused" : variable.configured ? "Configured" : "Missing"}
				</span>
			</div>
			<div className='secret-value-controls'>
				<input
					id={"secret-" + variable.name}
					aria-label={variable.name + " value"}
					type='password'
					autoComplete='new-password'
					maxLength={16384}
					value={value}
					disabled={disabled || saving}
					onChange={(event) => setValue(event.target.value)}
				/>
				<button type='submit' disabled={disabled || saving}>
					{saving ? "Setting…" : "Set"}
				</button>
			</div>
			{error && (
				<p className='secret-error' role='alert'>
					{error}
				</p>
			)}
		</form>
	);
};

export const SecretsForm = ({
	snapshot,
	disabled,
	onSet,
}: {
	snapshot: UiSecrets;
	disabled?: boolean;
	onSet(name: string, value: string): Promise<void>;
}) => {
	const [creating, setCreating] = useState(false);
	const [name, setName] = useState("");
	const [value, setValue] = useState("");
	const [error, setError] = useState("");
	const [saving, setSaving] = useState(false);
	const create = async () => {
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || name.startsWith("PAAS_")) {
			setError("Invalid secret name.");
			return;
		}
		if (snapshot.variables.some((variable) => variable.name === name)) {
			setError("Secret already exists.");
			return;
		}
		setError("");
		setSaving(true);
		try {
			await onSet(name, value);
			setName("");
			setValue("");
			setCreating(false);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Unable to set secret.");
		} finally {
			setSaving(false);
		}
	};
	return (
		<>
			{[
				...snapshot.variables.filter((variable) => variable.used),
				...snapshot.variables.filter((variable) => !variable.used),
			].map((variable) => (
				<SecretRow key={variable.name} variable={variable} disabled={disabled} onSet={onSet} />
			))}
			{creating ? (
				<form
					className='secret-add'
					onSubmit={(event) => {
						event.preventDefault();
						if (!disabled && !saving) void create();
					}}
				>
					<label>
						Secret name
						<input
							aria-label='Secret name'
							autoFocus
							autoComplete='off'
							maxLength={128}
							value={name}
							disabled={disabled || saving}
							onChange={(event) => setName(event.target.value)}
						/>
					</label>
					<label>
						Value
						<input
							aria-label='New secret value'
							type='password'
							autoComplete='new-password'
							maxLength={16384}
							value={value}
							disabled={disabled || saving}
							onChange={(event) => setValue(event.target.value)}
						/>
					</label>
					<button type='submit' disabled={disabled || saving}>
						{saving ? "Setting…" : "Set"}
					</button>
					<button
						type='button'
						disabled={disabled || saving}
						onClick={() => {
							setCreating(false);
							setValue("");
							setError("");
						}}
					>
						Cancel
					</button>
					{error && (
						<p className='secret-error' role='alert'>
							{error}
						</p>
					)}
				</form>
			) : (
				<button className='new-secret' type='button' disabled={disabled} onClick={() => setCreating(true)}>
					New secret
				</button>
			)}
		</>
	);
};
