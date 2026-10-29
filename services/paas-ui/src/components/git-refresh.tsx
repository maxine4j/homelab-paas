import { useEffect, useRef, useState } from "react";

import { refreshGit } from "../api.ts";
import type { GitRefreshState } from "../types.ts";

/** One user action; a cancelled view must not update feedback or reload another view. */
export const runGitRefresh = async (
	serviceId: string | undefined,
	signal: AbortSignal,
	update: (state: GitRefreshState) => void,
	reload: () => void,
	request: typeof fetch = fetch,
): Promise<void> => {
	update({ pending: true, message: "Fetching Git and reconciling…" });
	try {
		const { results } = await refreshGit(serviceId, signal, request);
		if (signal.aborted) return;
		const failed = results.filter((result) => !result.refreshed).map((result) => result.serviceId);
		update(
			failed.length
				? {
						pending: false,
						error: `${results.length - failed.length} of ${results.length} repositories refreshed. Git refresh failed for: ${failed.join(", ")}. Check repository access and retry. Deployment status is shown below.`,
					}
				: { pending: false, message: "Git refresh complete. Deployment status is shown below." },
		);
		reload();
	} catch (error) {
		if (!signal.aborted)
			update({
				pending: false,
				error: error instanceof Error ? error.message : "Cannot refresh Git. Retry shortly.",
			});
	}
};

export const GitRefreshFeedback = ({
	serviceId,
	pending,
	message,
	error,
	onRefresh,
}: Partial<GitRefreshState> & {
	serviceId?: string;
	onRefresh: () => void;
}) => (
	<div className='git-refresh'>
		<button type='button' disabled={pending} onClick={onRefresh}>
			{pending ? "Refreshing Git…" : serviceId ? "Refresh service from Git" : "Refresh all"}
		</button>
		{message && <p role='status'>{message}</p>}
		{error && <p role='alert'>{error}</p>}
	</div>
);

/** Mount with the route as key so navigation aborts the previous action. */
export const GitRefreshControl = ({ serviceId, onComplete }: { serviceId?: string; onComplete: () => void }) => {
	const [state, setState] = useState<GitRefreshState>({ pending: false });
	const controller = useRef<AbortController>(undefined);
	useEffect(() => () => controller.current?.abort(), []);
	const refresh = () => {
		if (controller.current && !controller.current.signal.aborted) return;
		const current = new AbortController();
		controller.current = current;
		void runGitRefresh(serviceId, current.signal, setState, onComplete).finally(() => {
			if (controller.current === current) controller.current = undefined;
		});
	};
	return <GitRefreshFeedback {...state} serviceId={serviceId} onRefresh={refresh} />;
};
