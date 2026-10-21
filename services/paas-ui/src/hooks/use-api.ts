import { useEffect, useState } from "react";

import { pollUi } from "../api.ts";

export const useApi = <T>(path: string | undefined) => {
	const [revision, setRevision] = useState(0);
	const [result, setResult] = useState<{ path?: string; data?: T; error?: string }>({});
	useEffect(() => {
		if (!path) return;
		return pollUi<T>(path, (result) => setResult({ path, ...result }));
	}, [path, revision]);
	return { ...(result.path === path ? result : {}), refresh: () => setRevision((value) => value + 1) };
};
