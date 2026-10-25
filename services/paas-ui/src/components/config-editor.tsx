import type { JsonValue, UiCluster, UiConfigField, UiEditableConfig } from "@homelab-paas/shared-contracts";
import { useEffect, useRef, useState } from "react";

import { fetchUi, saveConfig } from "../api.ts";

export const ConfigEditor = ({ snapshot }: { snapshot: UiEditableConfig }) => {
	const [base, setBase] = useState(snapshot);
	const [observedRevision, setObservedRevision] = useState(snapshot.revision);
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState("");
	const [error, setError] = useState("");
	const controller = useRef<AbortController>(undefined);
	const dirty = Object.keys(drafts).length > 0;
	useEffect(() => () => controller.current?.abort(), []);
	if (snapshot.revision !== observedRevision) {
		setObservedRevision(snapshot.revision);
		if (!dirty && !saving) setBase(snapshot);
	}
	const fieldValue = (field: UiConfigField): string =>
		field.kind === "secret"
			? ""
			: field.kind === "json"
				? JSON.stringify(field.value, null, 2)
				: field.kind === "list" && Array.isArray(field.value)
					? field.value.join("\n")
					: String(field.value ?? "");
	const save = async () => {
		setError("");
		setMessage("");
		const abort = new AbortController();
		controller.current = abort;
		try {
			const changes = base.fields
				.filter(
					(field) =>
						!field.readOnly
						&& Object.hasOwn(drafts, field.path)
						&& !(field.kind === "secret" && !drafts[field.path]),
				)
				.map((field) => {
					const text = drafts[field.path]!;
					let value: JsonValue = text;
					if (field.kind === "number") value = Number(text);
					if (field.kind === "list")
						value = text
							.split("\n")
							.map((line) => line.trim())
							.filter(Boolean);
					if (field.kind === "json") {
						try {
							value = JSON.parse(text);
						} catch {
							throw new Error("Services must contain valid JSON");
						}
					}
					return { path: field.path, value };
				});
			if (!changes.length) {
				setDrafts({});
				return;
			}
			setSaving(true);
			const saved = await saveConfig({ revision: base.revision, changes }, abort.signal);
			if (abort.signal.aborted) return;
			setBase(saved);
			setDrafts({});
			setMessage("Configuration saved");
		} catch (failure) {
			if (!abort.signal.aborted)
				setError(failure instanceof Error ? failure.message : "Cannot save configuration");
		} finally {
			if (!abort.signal.aborted) setSaving(false);
		}
	};
	const reload = async () => {
		const abort = new AbortController();
		controller.current = abort;
		setSaving(true);
		setError("");
		setMessage("");
		try {
			const latest = await fetchUi<UiCluster>("/cluster", abort.signal);
			if (abort.signal.aborted) return;
			setBase(latest);
			setDrafts({});
		} catch {
			if (!abort.signal.aborted) setError("Cannot reload configuration. Retry shortly.");
		} finally {
			if (!abort.signal.aborted) setSaving(false);
		}
	};
	return (
		<form
			className='config-editor'
			onSubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			<fieldset disabled={saving}>
				<legend>Platform settings</legend>
				<p>
					Leave secret fields empty to keep their current values. Services use a JSON object keyed by service
					ID.
				</p>
				<div className='config-fields'>
					{base.fields.map((field) => (
						<div
							className={`config-field ${field.kind === "json" ? "config-field-wide" : ""}`}
							key={field.path}
						>
							<label htmlFor={`config-${field.path}`}>{field.path}</label>
							{field.kind === "json" || field.kind === "list" ? (
								<textarea
									id={`config-${field.path}`}
									rows={field.kind === "json" ? 12 : 3}
									spellCheck={false}
									readOnly={field.readOnly}
									value={drafts[field.path] ?? fieldValue(field)}
									onChange={(event) =>
										setDrafts((previous) => ({ ...previous, [field.path]: event.target.value }))
									}
								/>
							) : (
								<input
									id={`config-${field.path}`}
									type={
										field.kind === "secret"
											? "password"
											: field.kind === "number"
												? "number"
												: "text"
									}
									autoComplete={field.kind === "secret" ? "new-password" : "off"}
									min={field.kind === "number" ? 1 : undefined}
									step={field.kind === "number" ? 1 : undefined}
									readOnly={field.readOnly}
									placeholder={
										field.kind === "secret"
											? field.configured
												? "Configured — enter replacement"
												: "Not configured"
											: undefined
									}
									value={drafts[field.path] ?? fieldValue(field)}
									onChange={(event) =>
										setDrafts((previous) => ({ ...previous, [field.path]: event.target.value }))
									}
								/>
							)}
							<small>
								{field.managedByEnvironment
									? "Managed by environment"
									: field.readOnly
										? field.path.startsWith("ingress.") || field.path.startsWith("metadata.")
											? "Requires restart — edit the host file"
											: "Read only"
										: field.kind === "secret"
											? "Replacement only; current value is never returned"
											: field.kind === "list"
												? "One value per line"
												: ""}
							</small>
						</div>
					))}
				</div>
				<div className='config-actions'>
					<button type='submit' disabled={!dirty}>
						{saving ? "Saving…" : "Save configuration"}
					</button>
					<button type='button' onClick={() => void reload()}>
						Reload configuration
					</button>
					{dirty && <span>Unsaved changes</span>}
				</div>
			</fieldset>
			{message && <p role='status'>{message}</p>}
			{error && <p role='alert'>{error}</p>}
		</form>
	);
};
