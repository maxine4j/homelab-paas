import type { UiServiceEvent } from "@homelab-paas/shared-contracts";

import { ServiceEvents } from "../components/service-events.tsx";

export const ResourceEventsPage = ({
	serviceId,
	resourceId,
	events,
	error,
}: {
	serviceId: string;
	resourceId: string;
	events?: UiServiceEvent[];
	error?: string;
}) => (
	<>
		<a className='back-link' href={`#/services/${serviceId}/resources/${resourceId}`}>
			← {resourceId}
		</a>
		<div className='page-heading'>
			<div>
				<p className='eyebrow'>
					{serviceId} / {resourceId}
				</p>
				<h1>Resource events</h1>
				<p>
					Matching events from the latest 200 service events, newest first. Retry times reflect the schedule
					at the time of each event.
				</p>
			</div>
		</div>
		<ServiceEvents events={events?.filter((event) => event.resourceId === resourceId)} error={error} />
	</>
);
