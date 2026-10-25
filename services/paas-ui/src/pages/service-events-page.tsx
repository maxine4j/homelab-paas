import type { UiServiceEvent } from "@homelab-paas/shared-contracts";

import { ServiceEvents } from "../components/service-events.tsx";

export const ServiceEventsPage = ({
	serviceId,
	events,
	error,
}: {
	serviceId: string;
	events?: UiServiceEvent[];
	error?: string;
}) => (
	<>
		<a className='back-link' href={`#/services/${serviceId}`}>
			← {serviceId}
		</a>
		<div className='page-heading'>
			<div>
				<p className='eyebrow'>{serviceId}</p>
				<h1>Service events</h1>
				<p>Latest 200 events, newest first. Retry times reflect the schedule at the time of each event.</p>
			</div>
		</div>
		<ServiceEvents events={events} error={error} />
	</>
);
