import type { UiService, UiServiceEvent } from "@homelab-paas/shared-contracts";
import type { ReactNode } from "react";

import { CodeHighlight } from "../components/code-highlight.tsx";
import { gitCommitLink } from "../components/git-source-link.ts";
import { HealthTimeline } from "../components/health-timeline.tsx";
import { ServiceDetailShell } from "../components/service-detail-shell.tsx";
import { ServiceEvents } from "../components/service-events.tsx";
import { ServiceResources } from "../components/service-resources.tsx";
import { ServiceRevision } from "../components/service-revision.tsx";
import { StatusBadges } from "../components/status-badge.tsx";
import type { ServiceTab } from "../types.ts";

export const ServicePage = ({
	service,
	events,
	eventError,
	tab = "overview",
	actions,
}: {
	service: UiService;
	events?: UiServiceEvent[];
	eventError?: string;
	tab?: ServiceTab;
	actions?: ReactNode;
}) => {
	return (
		<ServiceDetailShell serviceId={service.serviceId} service={service} tab={tab} actions={actions}>
			{service.descriptorStatus === "unavailable" && (
				<p className='notice' role='status'>
					Descriptor unavailable. Showing observed resources; desired configuration could not be loaded.
				</p>
			)}
			{tab === "overview" && (
				<>
					<section className='service-commit-panels' aria-label='Service revisions'>
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
					</section>
					<HealthTimeline
						label='Service health history'
						timeline={service.healthTimeline}
						events={events}
						eventError={eventError}
						legend
					/>
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
									<h3 title={resource.resourceId}>{resource.resourceId}</h3>
									<StatusBadges health={resource.health} sync={resource.sync} />
								</div>
								<span className='eyebrow'>{resource.type}</span>
							</a>
						))}
					</div>
				</>
			)}
			{tab === "resources" && (
				<ServiceResources
					serviceId={service.serviceId}
					resources={service.resources}
					events={events}
					eventError={eventError}
				/>
			)}
			{tab === "descriptor" && (
				<section aria-label='Service descriptor'>
					<h2>Service descriptor</h2>
					{service.descriptorYaml ? (
						<pre className='code-view' tabIndex={0} aria-label='Service descriptor YAML'>
							<CodeHighlight language='yaml'>{service.descriptorYaml}</CodeHighlight>
						</pre>
					) : (
						<p className='empty'>Descriptor YAML unavailable.</p>
					)}
				</section>
			)}
		</ServiceDetailShell>
	);
};
