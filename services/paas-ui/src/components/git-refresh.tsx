import { RefreshCw, RotateCcw, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { refreshGit, redeployService, changeServiceLifecycle } from "../api.ts";
import type { GitRefreshState } from "../types.ts";
import { ActionToast } from "./action-toast.tsx";

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

export const runServiceLifecycle = async (
	serviceId: string,
	action: "pause" | "resume",
	signal: AbortSignal,
	update: (state: GitRefreshState) => void,
	reload: () => void,
	request: typeof fetch = fetch,
): Promise<void> => {
	update({ pending: true, message: action === "pause" ? "Pausing service…" : "Resuming service…" });
	try {
		await changeServiceLifecycle(serviceId, action, signal, request);
		if (!signal.aborted)
			update({ pending: false, message: action === "pause" ? "Service paused." : "Service resumed." });
	} catch (error) {
		if (!signal.aborted)
			update({ pending: false, error: error instanceof Error ? error.message : `Cannot ${action} service.` });
	} finally {
		if (!signal.aborted) reload();
	}
};

export const GitRefreshFeedback = ({
	serviceId,
	pending,
	message,
	error,
	onRefresh,
	onRedeploy,
	onLifecycle,
	paused = false,
	unavailable = false,
}: Partial<GitRefreshState> & {
	serviceId?: string;
	onRefresh: () => void;
	onRedeploy?: () => void;
	onLifecycle?: () => void;
	paused?: boolean;
	unavailable?: boolean;
}) => (
	<div className='git-refresh'>
		<div className='service-actions'>
			<button className='action-info' type='button' disabled={pending} onClick={onRefresh}>
				<RefreshCw className={pending ? "action-spinner" : undefined} aria-hidden='true' />
				{serviceId ? "Refresh" : "Refresh all"}
			</button>
			{serviceId && onRedeploy && (
				<button className='action-warning' type='button' disabled={pending || paused} onClick={onRedeploy}>
					<RotateCcw className={pending ? "action-spinner" : undefined} aria-hidden='true' />
					Redeploy
				</button>
			)}
			{serviceId && onLifecycle && (
				<button className='action-pause' type='button' disabled={pending || unavailable} onClick={onLifecycle}>
					{paused ? <Play aria-hidden='true' /> : <Pause aria-hidden='true' />}
					{paused ? "Resume" : "Pause"}
				</button>
			)}
		</div>
		{pending && message && (
			<p className='action-pending' role='status'>
				{message}
			</p>
		)}
		{!pending && (error || message) && (
			<ActionToast key={error || message} message={error ?? message ?? ""} error={!!error} />
		)}
	</div>
);

/** Mount with the route as key so navigation aborts the previous action. */
export const GitRefreshControl = ({
	serviceId,
	onComplete,
	paused = false,
	unavailable = false,
}: {
	serviceId?: string;
	onComplete: () => void;
	paused?: boolean;
	unavailable?: boolean;
}) => {
	const [state, setState] = useState<GitRefreshState>({ pending: false });
	const controller = useRef<AbortController>(undefined);
	useEffect(() => () => controller.current?.abort(), []);
	const run = (action: "refresh" | "redeploy" | "pause" | "resume") => {
		if (controller.current && !controller.current.signal.aborted) return;
		const current = new AbortController();
		controller.current = current;
		const operation =
			(action === "pause" || action === "resume") && serviceId
				? runServiceLifecycle(serviceId, action, current.signal, setState, onComplete)
				: action === "redeploy" && serviceId
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
			paused={paused}
			unavailable={unavailable}
			onRefresh={() => run("refresh")}
			onRedeploy={() => run("redeploy")}
			onLifecycle={() => run(paused ? "resume" : "pause")}
		/>
	);
};
