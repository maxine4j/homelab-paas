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
import type { ApiResult } from "./types.ts";

/** Poll after each completed request; cancellation suppresses stale responses. */
export const pollUi = <T>(
	path: string,
	update: (result: ApiResult<T>) => void,
	request: typeof fetch = fetch,
): (() => void) => {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout>;
	const refresh = async () => {
		try {
			const data = await fetchUi<T>(path, controller.signal, request);
			if (!controller.signal.aborted) update({ data });
		} catch (error) {
			if (!controller.signal.aborted)
				update({ error: error instanceof Error ? error.message : "Unable to connect to the cluster" });
		} finally {
			if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 5000);
		}
	};
	void refresh();
	return () => {
		controller.abort();
		clearTimeout(timer);
	};
};
