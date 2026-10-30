import { useEffect, useRef, useState } from "react";

import { refreshGit, redeployService } from "../api.ts";
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

export const runRedeploy = async (
	serviceId: string,
	signal: AbortSignal,
	update: (state: GitRefreshState) => void,
	reload: () => void,
	request: typeof fetch = fetch,
): Promise<void> => {
	update({ pending: true, message: "Redeploying service containers…" });
	try {
		await redeployService(serviceId, signal, request);
		if (signal.aborted) return;
		update({ pending: false, message: "Redeploy complete." });
		reload();
	} catch (error) {
		if (!signal.aborted)
			update({ pending: false, error: error instanceof Error ? error.message : "Cannot redeploy service." });
	}
};

export const GitRefreshFeedback = ({
	serviceId,
	pending,
	message,
	error,
	onRefresh,
	onRedeploy,
}: Partial<GitRefreshState> & {
	serviceId?: string;
	onRefresh: () => void;
	onRedeploy?: () => void;
}) => (
	<div className='git-refresh'>
		<div className='service-actions'>
			<button className='action-info' type='button' disabled={pending} onClick={onRefresh}>
				{serviceId ? "Refresh" : "Refresh all"}
			</button>
			{serviceId && onRedeploy && (
				<button className='action-warning' type='button' disabled={pending} onClick={onRedeploy}>
					Redeploy
				</button>
			)}
		</div>
		{message && <p role='status'>{message}</p>}
		{error && <p role='alert'>{error}</p>}
	</div>
);

/** Mount with the route as key so navigation aborts the previous action. */
export const GitRefreshControl = ({ serviceId, onComplete }: { serviceId?: string; onComplete: () => void }) => {
	const [state, setState] = useState<GitRefreshState>({ pending: false });
	const controller = useRef<AbortController>(undefined);
	useEffect(() => () => controller.current?.abort(), []);
	const run = (redeploy: boolean) => {
		if (controller.current && !controller.current.signal.aborted) return;
		const current = new AbortController();
		controller.current = current;
		const operation =
			redeploy && serviceId
				? runRedeploy(serviceId, current.signal, setState, onComplete)
				: runGitRefresh(serviceId, current.signal, setState, onComplete);
		void operation.finally(() => {
			if (controller.current === current) controller.current = undefined;
		});
	};
	return (
		<GitRefreshFeedback
			{...state}
			serviceId={serviceId}
			onRefresh={() => run(false)}
			onRedeploy={() => run(true)}
		/>
	);
};
