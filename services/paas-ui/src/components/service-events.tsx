import type { UiServiceEvent } from "@homelab-paas/shared-contracts";

import { EventCopy } from "./event-copy.tsx";
import { presentDiagnostics } from "./event-diagnostics.ts";

export const ServiceEvents = ({ events, error }: { events?: UiServiceEvent[]; error?: string }) => {
	if (error)
		return (
			<p className='notice' role='alert'>
				{error}
			</p>
		);
	if (!events)
		return (
			<p className='empty' role='status'>
				Loading events…
			</p>
		);
	if (events.length === 0) return <p className='empty'>No events recorded yet.</p>;
	return (
		<ol className='service-events'>
			{events.map((event, index) => {
				const diagnostics = event.diagnostics ? presentDiagnostics(event.diagnostics) : undefined;
				return (
					<li
						className={`service-event service-event-${event.level}`}
						key={`${event.timestamp}-${event.event}-${index}`}
					>
						<div className='event-heading'>
							<span className={`badge badge-${event.level}`}>{event.level}</span>
							<time dateTime={new Date(event.timestamp).toISOString()}>
								{new Date(event.timestamp).toLocaleString()}
							</time>
						</div>
						<p className='event-message'>{diagnostics?.message ?? event.message}</p>
						{diagnostics && (
							<details className='event-diagnostics'>
								<summary>Error diagnostics</summary>
								<h3>Stack trace</h3>
								<pre tabIndex={0}>{diagnostics.stack || "Stack trace unavailable."}</pre>
								<h3>Context</h3>
								{diagnostics.context ? (
									<pre tabIndex={0}>{diagnostics.context}</pre>
								) : (
									<p className='muted'>Context unavailable.</p>
								)}
							</details>
						)}
						{event.secretFailure && (
							<div className='secret-failure'>
								<p>
									{event.secretFailure.reason === "missing-file"
										? "Secret file is missing"
										: event.secretFailure.reason === "unreadable-file"
											? "Secret file cannot be read; check permissions and mounts"
											: event.secretFailure.reason === "invalid-file"
												? "Invalid secret file format"
												: "Required secret variables are missing"}
								</p>
								{event.secretFailure.missingVariables?.length ? (
									<p>
										Missing variables:{" "}
										<code>{event.secretFailure.missingVariables.join(", ")}</code>
									</p>
								) : undefined}
								{event.secretFailure.hostFilePath ? (
									<p>
										Edit on Docker host: <code>{event.secretFailure.hostFilePath}</code>
									</p>
								) : (
									<p>
										Host path unavailable. Check the control-plane bind mount for the container path
										below.
									</p>
								)}
								<p>
									Container path: <code>{event.secretFailure.filePath}</code>
								</p>
								{event.secretFailure.line && <p>Line {event.secretFailure.line}</p>}
							</div>
						)}
						<div className='event-metadata'>
							<code>{event.event}</code>
							{event.resourceId && <span>Resource: {event.resourceId}</span>}
							{event.revision && (
								<span>
									Revision: <code title={event.revision}>{event.revision.slice(0, 12)}</code>
								</span>
							)}
							{event.failures !== undefined && <span>Attempt {event.failures}</span>}
							{event.retryAt !== undefined && (
								<span>
									Next retry:{" "}
									<time dateTime={new Date(event.retryAt).toISOString()}>
										{new Date(event.retryAt).toLocaleString()}
									</time>
								</span>
							)}
						</div>
						<EventCopy event={event} />
					</li>
				);
			})}
		</ol>
	);
};
