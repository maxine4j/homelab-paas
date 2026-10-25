import type { UiServiceEvent } from "@homelab-paas/shared-contracts";

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
			{events.map((event, index) => (
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
					<p className='event-message'>{event.message}</p>
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
				</li>
			))}
		</ol>
	);
};
