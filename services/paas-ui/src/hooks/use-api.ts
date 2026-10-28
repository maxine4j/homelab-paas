import { useEffect, useState } from "react";

import { fetchUi } from "../api.ts";
import { subscribeUi } from "../live.ts";
import type { ApiResult } from "../types.ts";

export const mergeApiResult = <T>(
	path: string,
	previous: ApiResult<T> & { path?: string },
	update: ApiResult<T>,
): ApiResult<T> & { path: string } => ({
	path,
	...update,
	data: update.data === undefined && previous.path === path ? previous.data : update.data,
});

export const useApi = <T>(path: string | undefined) => {
	const [revision, setRevision] = useState(0);
	const [result, setResult] = useState<ApiResult<T> & { path?: string }>({});
	useEffect(() => {
		if (!path) return;
		if (import.meta.env.MODE === "mock") {
			const controller = new AbortController();
			void fetchUi<T>(path, controller.signal).then(
				(data) => {
					if (!controller.signal.aborted) setResult({ path, data });
				},
				() => {
					if (!controller.signal.aborted) setResult({ path, error: "Mock snapshot unavailable" });
				},
			);
			return () => controller.abort();
		}
		return subscribeUi<T>(path, (update) => setResult((previous) => mergeApiResult(path, previous, update)));
	}, [path, revision]);
	return { ...(result.path === path ? result : {}), refresh: () => setRevision((value) => value + 1) };
};
