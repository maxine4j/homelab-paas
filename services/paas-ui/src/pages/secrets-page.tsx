import type { UiSecrets } from "@homelab-paas/shared-contracts";
import { useEffect, useRef, useState } from "react";

import { fetchUi, saveSecrets } from "../api.ts";
import { SecretsForm } from "../components/secrets-form.tsx";
import { ServiceDetailShell } from "../components/service-detail-shell.tsx";

export const SecretsPage = ({ serviceId }: { serviceId: string }) => {
	const preview = import.meta.env.MODE === "mock";
	const [snapshot, setSnapshot] = useState<UiSecrets>();
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(true);
	const [error, setError] = useState("");
	const [message, setMessage] = useState("");
	const controller = useRef<AbortController>(undefined);
	const read = async (abort: AbortController) => {
		try {
			const latest = await fetchUi<UiSecrets>(`/services/${encodeURIComponent(serviceId)}/secrets`, abort.signal);
			if (!abort.signal.aborted) setSnapshot(latest);
		} catch (failure) {
			if (!abort.signal.aborted)
				setError(
					failure instanceof Error
						? failure.message
						: "Cannot load secrets. Check service descriptor and env file access, then reload status. Drafts are retained.",
				);
		} finally {
			if (!abort.signal.aborted) setBusy(false);
		}
	};
	const load = async () => {
		controller.current?.abort();
		const abort = new AbortController();
		controller.current = abort;
		setBusy(true);
		setError("");
		setMessage("");
		await read(abort);
	};
	useEffect(() => {
		const abort = new AbortController();
		controller.current = abort;
		void fetchUi<UiSecrets>(`/services/${encodeURIComponent(serviceId)}/secrets`, abort.signal)
			.then((latest) => {
				if (!abort.signal.aborted) setSnapshot(latest);
			})
			.catch((failure: unknown) => {
				if (!abort.signal.aborted)
					setError(failure instanceof Error ? failure.message : "Cannot load secrets; retry shortly.");
			})
			.finally(() => {
				if (!abort.signal.aborted) setBusy(false);
			});
		return () => controller.current?.abort();
	}, [serviceId]);
	const save = async () => {
		if (!snapshot || preview) return;
		const abort = new AbortController();
		controller.current?.abort();
		controller.current = abort;
		setBusy(true);
		setError("");
		setMessage("");
		try {
			const saved = await saveSecrets(
				serviceId,
				{
					revision: snapshot.revision,
					changes: Object.entries(drafts).map(([name, value]) => ({ name, value })),
				},
				abort.signal,
			);
			if (abort.signal.aborted) return;
			setSnapshot(saved);
			setDrafts({});
			setMessage(
				"Secrets saved. Regular reconciliation will apply changes; scheduled retry backoff still applies.",
			);
		} catch (failure) {
			if (!abort.signal.aborted)
				setError(failure instanceof Error ? failure.message : "Cannot save secrets. Drafts are retained.");
		} finally {
			if (!abort.signal.aborted) setBusy(false);
		}
	};
	return (
		<ServiceDetailShell serviceId={serviceId} tab='secrets'>
			<section className='card secrets-editor'>
				<h2>Service secrets</h2>
				<p>
					Saved to <code>/etc/homelab-paas/env/{serviceId}.env</code>. Changes apply through regular
					reconciliation and its retry schedule.
				</p>
				<p className='muted'>
					Use single-line values. Newlines, NUL and values containing both single and double quotes cannot be
					stored in this dotenv format.
				</p>
				{preview && <p className='notice'>Mock preview is read-only.</p>}
				{error && (
					<p className='notice' role='alert'>
						{error}
					</p>
				)}
				{message && <p role='status'>{message}</p>}
				{snapshot ? (
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void save();
						}}
					>
						<SecretsForm
							snapshot={snapshot}
							drafts={drafts}
							disabled={busy || preview}
							onDraft={(name, value) =>
								setDrafts((current) =>
									value === undefined
										? Object.fromEntries(Object.entries(current).filter(([key]) => key !== name))
										: { ...current, [name]: value },
								)
							}
						/>
						<div className='form-actions'>
							<button disabled={busy || preview || !Object.keys(drafts).length} type='submit'>
								{busy ? "Saving…" : "Save secrets"}
							</button>
							<button type='button' disabled={busy} onClick={() => void load()}>
								Reload status (keep drafts)
							</button>
						</div>
					</form>
				) : (
					<>
						<p role='status'>{busy ? "Loading secrets…" : "Secret status unavailable."}</p>
						<button type='button' disabled={busy} onClick={() => void load()}>
							Reload status
						</button>
					</>
				)}
			</section>
		</ServiceDetailShell>
	);
};
