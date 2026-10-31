import type { UiService, UiServiceEvent } from "@homelab-paas/shared-contracts";
import type { ReactNode } from "react";

import { ServiceDetailShell } from "../components/service-detail-shell.tsx";
import { ServiceEvents } from "../components/service-events.tsx";

export const ServiceEventsPage = ({
	serviceId,
	service,
	serviceError,
	events,
	error,
	actions,
}: {
	serviceId: string;
	service?: UiService;
	serviceError?: string;
	events?: UiServiceEvent[];
	error?: string;
	actions?: ReactNode;
}) => (
	<ServiceDetailShell
		serviceId={serviceId}
		service={service}
		serviceError={serviceError}
		tab='events'
		actions={actions}
	>
		<h2>Service events</h2>
		<p>Latest 200 events, newest first. Retry times reflect the schedule at the time of each event.</p>
		<ServiceEvents serviceId={serviceId} events={events} error={error} />
	</ServiceDetailShell>
);
