import type { UiConfigUpdate, UiEditableConfig, UiGitRefresh } from "@homelab-paas/shared-contracts";

/** Explicit Git refresh; cancellation stops waiting, but server work may finish. */
export async function refreshGit(
	serviceId: string | undefined,
	signal: AbortSignal,
	request: typeof fetch = fetch,
): Promise<UiGitRefresh> {
	const response = await request(`/api/ui/services/${serviceId ? `${encodeURIComponent(serviceId)}/` : ""}refresh`, {
		method: "POST",
		cache: "no-store",
		credentials: "same-origin",
		headers: { "x-paas-refresh": "1" },
		signal,
	});
	if (!response.ok)
		throw new Error(
			response.status === 401
				? "A platform session is required. Sign in again."
				: response.status === 404
					? "Service is not configured. Reload the service list."
					: "Cannot refresh Git. Check repository access and retry. The request may have completed; reload the page to check.",
		);
	return response.json();
}

export async function saveConfig(
	update: UiConfigUpdate,
	signal: AbortSignal,
	request: typeof fetch = fetch,
): Promise<UiEditableConfig> {
	const response = await request("/api/ui/cluster/config", {
		method: "PUT",
		cache: "no-store",
		credentials: "same-origin",
		headers: { "content-type": "application/json", "x-paas-config": "1" },
		body: JSON.stringify(update),
		signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
	});
	if (!response.ok)
		throw new Error(
			response.status === 401
				? "A platform session is required. Sign in again."
				: response.status === 409
					? "Configuration changed. Reload configuration and reapply your edits."
					: response.status === 400
						? "Invalid configuration. Check values and read-only fields."
						: "Cannot save configuration. Check host file access and retry.",
		);
	return response.json();
}

export async function fetchUi<T>(path: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<T> {
	const response = await request(`/api/ui${path}`, {
		cache: "no-store",
		credentials: "same-origin",
		signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
	});
	if (!response.ok)
		throw new Error(
			response.status === 401
				? "A platform session is required. Sign in through your cluster's authentication host."
				: response.status === 404
					? "Requested item was not found"
					: "Cluster data is unavailable. Check the control plane and retry.",
		);
	return response.json();
}
