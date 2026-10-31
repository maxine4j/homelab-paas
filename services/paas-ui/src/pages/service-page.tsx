import type { UiService, UiServiceEvent } from "@homelab-paas/shared-contracts";

import { ServiceDetailShell } from "../components/service-detail-shell.tsx";
import { ServiceEvents } from "../components/service-events.tsx";
import { ServiceResources } from "../components/service-resources.tsx";
import { StatusBadge } from "../components/status-badge.tsx";
import type { ServiceTab } from "../types.ts";

export const ServicePage = ({
	service,
	events,
	eventError,
	tab = "overview",
}: {
	service: UiService;
	events?: UiServiceEvent[];
	eventError?: string;
	tab?: ServiceTab;
}) => {
	return (
		<ServiceDetailShell serviceId={service.serviceId} service={service} tab={tab}>
			{service.descriptorStatus === "unavailable" && (
				<p className='notice' role='status'>
					Descriptor unavailable. Showing observed resources; desired configuration could not be loaded.
				</p>
			)}
			{tab === "overview" && (
				<>
					{service.retryAt && (
						<dl className='summary'>
							<div>
								<dt>Next retry</dt>
								<dd>{new Date(service.retryAt).toLocaleString()}</dd>
							</div>
						</dl>
					)}
					<section className='recent-events' aria-label='Recent service events'>
						<div className='section-heading'>
							<h2>Recent events</h2>
							{events && events.length > 2 && (
								<a href={`#/services/${service.serviceId}/events`}>
									{events.length - 2} more events...
								</a>
							)}
							{eventError && <a href={`#/services/${service.serviceId}/events`}>Event history</a>}
						</div>
						<ServiceEvents serviceId={service.serviceId} events={events?.slice(0, 2)} error={eventError} />
					</section>
					<h2>
						Resources <span className='count'>{service.resources.length}</span>
					</h2>
					<div className='card-grid resource-grid'>
						{service.resources.map((resource) => (
							<a
								className='card resource-link'
								key={resource.resourceId}
								href={`#/services/${service.serviceId}/resources/${resource.resourceId}`}
							>
								<div className='card-top'>
									<span className='eyebrow'>{resource.type}</span>
									<StatusBadge status={resource.health} />
								</div>
								<h3>{resource.resourceId}</h3>
							</a>
						))}
					</div>
				</>
			)}
			{tab === "resources" && <ServiceResources serviceId={service.serviceId} resources={service.resources} />}
		</ServiceDetailShell>
	);
};
