import type { UiServiceEvent } from "@homelab-paas/shared-contracts";

import { ResourceDetailShell } from "../components/resource-detail-shell.tsx";
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
	<ResourceDetailShell serviceId={serviceId} resourceId={resourceId} tab='events'>
		<h2>Resource events</h2>
		<p>
			Matching events from the latest 200 service events, newest first. Retry times reflect the schedule at the
			time of each event.
		</p>
		<ServiceEvents
			serviceId={serviceId}
			events={events?.filter((event) => event.resourceId === resourceId)}
			error={error}
		/>
	</ResourceDetailShell>
);
