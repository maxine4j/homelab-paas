import type { UiSecrets, UiService } from "@homelab-paas/shared-contracts";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { fetchUi, saveSecrets } from "../api.ts";
import { SecretsForm } from "../components/secrets-form.tsx";
import { ServiceDetailShell } from "../components/service-detail-shell.tsx";

export const setSecret = async (
	serviceId: string,
	revision: string,
	name: string,
	value: string,
	signal: AbortSignal,
	request: typeof fetch,
	updateSnapshot: (snapshot: UiSecrets) => void,
): Promise<void> => {
	try {
		const saved = await saveSecrets(serviceId, { revision, changes: [{ name, value }] }, signal, request);
		if (!signal.aborted) updateSnapshot(saved);
	} catch (failure) {
		if (!signal.aborted) {
			try {
				const latest = await fetchUi<UiSecrets>(
					"/services/" + encodeURIComponent(serviceId) + "/secrets",
					signal,
					request,
				);
				if (!signal.aborted) updateSnapshot(latest);
			} catch {
				/* Preserve the original write failure if metadata is also unavailable. */
			}
		}
		throw failure;
	}
};

export const SecretsPage = ({
	serviceId,
	service,
	actions,
}: {
	serviceId: string;
	service?: UiService;
	actions?: ReactNode;
}) => {
	const preview = import.meta.env.MODE === "mock";
	const [snapshot, setSnapshot] = useState<UiSecrets>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const controller = useRef<AbortController>(undefined);
	const pending = useRef(false);
	useEffect(() => {
		const abort = new AbortController();
		controller.current = abort;
		void fetchUi<UiSecrets>("/services/" + encodeURIComponent(serviceId) + "/secrets", abort.signal).then(
			(latest) => {
				if (!abort.signal.aborted) setSnapshot(latest);
			},
			() => {
				if (!abort.signal.aborted) setError("Unable to load secrets.");
			},
		);
		return () => controller.current?.abort();
	}, [serviceId]);
	const save = async (name: string, value: string): Promise<void> => {
		if (!snapshot || preview || pending.current) throw new Error("Unable to set secret. Try again.");
		const abort = new AbortController();
		controller.current?.abort();
		controller.current = abort;
		pending.current = true;
		setBusy(true);
		try {
			await setSecret(serviceId, snapshot.revision, name, value, abort.signal, fetch, setSnapshot);
		} finally {
			pending.current = false;
			if (!abort.signal.aborted) setBusy(false);
		}
	};
	return (
		<ServiceDetailShell serviceId={serviceId} service={service} tab='secrets' actions={actions}>
			<section className='card secrets-editor'>
				<h2>Service secrets</h2>
				{error && <p role='alert'>{error}</p>}
				{snapshot ? (
					<SecretsForm snapshot={snapshot} disabled={busy || preview} onSet={save} />
				) : (
					!error && <p role='status'>Loading secrets…</p>
				)}
			</section>
		</ServiceDetailShell>
	);
};
