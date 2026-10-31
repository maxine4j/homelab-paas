import type { UiServiceEvent } from "@homelab-paas/shared-contracts";

import { ServiceDetailShell } from "../components/service-detail-shell.tsx";
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
	<ServiceDetailShell serviceId={serviceId} tab='events'>
		<h2>Service events</h2>
		<p>Latest 200 events, newest first. Retry times reflect the schedule at the time of each event.</p>
		<ServiceEvents events={events} error={error} />
	</ServiceDetailShell>
);
