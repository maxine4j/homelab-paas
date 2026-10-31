import type { UiService, UiServiceEvent } from "@homelab-paas/shared-contracts";

import { gitCommitLink } from "../components/git-source-link.ts";
import { ServiceEvents } from "../components/service-events.tsx";
import { ServiceResources } from "../components/service-resources.tsx";
import { ServiceRevision } from "../components/service-revision.tsx";
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
	const base = `#/services/${service.serviceId}`;
	const primaryUrl = service.resources.find((resource) => resource.type === "web" && resource.primaryUrl)?.primaryUrl;
	return (
		<>
			<div className='page-heading service-heading'>
				<div className='service-heading-content'>
					<div className='service-heading-row'>
						<div className='service-identity-block'>
							<div className='service-identity'>
								<h1>{service.serviceId}</h1>
								<StatusBadge status={service.phase} />
							</div>
							{primaryUrl && (
								<a className='primary-web-link' href={primaryUrl} target='_blank' rel='noreferrer'>
									{new URL(primaryUrl).host} <span aria-hidden='true'>↗</span>
								</a>
							)}
						</div>
						<div className='service-commit-panels'>
							<ServiceRevision
								label='Active revision'
								revision={service.activeRevision}
								href={gitCommitLink(service.source, service.activeRevision)}
								metadata={service.activeRevisionMetadata}
								fallback='Not deployed'
							/>
							<ServiceRevision
								label='Desired revision'
								revision={service.descriptorRevision}
								href={gitCommitLink(service.source, service.descriptorRevision)}
								metadata={service.descriptorRevisionMetadata}
								fallback='Unavailable'
							/>
						</div>
					</div>
				</div>
			</div>
			<nav className='tabs' aria-label='Service detail'>
				<a href={base} aria-current={tab === "overview" ? "page" : undefined}>
					Overview
				</a>
				<a href={`${base}/resources`} aria-current={tab === "resources" ? "page" : undefined}>
					Resources
				</a>
			</nav>
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
						<ServiceEvents events={events?.slice(0, 2)} error={eventError} />
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
		</>
	);
};
