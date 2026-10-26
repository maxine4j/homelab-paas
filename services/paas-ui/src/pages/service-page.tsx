import type { UiService, UiServiceEvent } from "@homelab-paas/shared-contracts";

import { gitSourceLink } from "../components/git-source-link.ts";
import { RevisionDetails } from "../components/revision-details.tsx";
import { ServiceEvents } from "../components/service-events.tsx";
import { StatusBadge } from "../components/status-badge.tsx";

export const ServicePage = ({
	service,
	events,
	eventError,
}: {
	service: UiService;
	events?: UiServiceEvent[];
	eventError?: string;
}) => {
	const sourceUrl = gitSourceLink(service.source, service.descriptorRevision);
	const primaryUrl = service.resources.find((resource) => resource.type === "web" && resource.primaryUrl)?.primaryUrl;
	return (
		<>
			<a className='back-link' href='#/services'>
				← Services
			</a>
			<div className='page-heading service-heading'>
				<div className='service-heading-content'>
					<p className='eyebrow'>Service</p>
					<div className='service-heading-row'>
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
				</div>
			</div>
			{service.descriptorStatus === "unavailable" && (
				<p className='notice' role='status'>
					Descriptor unavailable. Showing observed resources; desired configuration could not be loaded.
				</p>
			)}
			<dl className='summary'>
				<div>
					<dt>Active revision</dt>
					<RevisionDetails
						revision={service.activeRevision}
						metadata={service.activeRevisionMetadata}
						fallback='Not deployed'
					/>
				</div>
				<div>
					<dt>Desired revision</dt>
					<RevisionDetails
						revision={service.descriptorRevision}
						metadata={service.descriptorRevisionMetadata}
						fallback='Unavailable'
					/>
				</div>
				{service.retryAt && (
					<div>
						<dt>Next retry</dt>
						<dd>{new Date(service.retryAt).toLocaleString()}</dd>
					</div>
				)}
			</dl>
			<section aria-label='Latest service event'>
				<div className='section-heading'>
					<h2>Latest event</h2>
					{events && events.length > 1 && (
						<a href={`#/services/${service.serviceId}/events`}>{events.length - 1} more events...</a>
					)}
					{eventError && <a href={`#/services/${service.serviceId}/events`}>Event history</a>}
				</div>
				<ServiceEvents events={events?.slice(0, 1)} error={eventError} />
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
							<span className='pill'>{resource.containers.length} containers</span>
						</div>
						<h3>{resource.resourceId}</h3>
						<p>
							{resource.containers.length
								? resource.containers.map((container) => container.state).join(" · ")
								: "No containers"}
						</p>
					</a>
				))}
			</div>
			<section aria-labelledby='service-descriptor-heading'>
				<div className='section-heading'>
					<h2 id='service-descriptor-heading'>Service descriptor</h2>
					{sourceUrl ? (
						<a href={sourceUrl} target='_blank' rel='noreferrer'>
							Service source ↗
						</a>
					) : (
						<span className='muted'>Source link unavailable</span>
					)}
				</div>
				{service.descriptor ? (
					<details className='json-disclosure'>
						<summary>Service descriptor YAML</summary>
						<pre className='code-view' tabIndex={0} aria-label='Service descriptor YAML'>
							{service.descriptorYaml ?? "Descriptor unavailable."}
						</pre>
					</details>
				) : (
					<p>Descriptor unavailable.</p>
				)}
			</section>
		</>
	);
};
