import type { UiLogs, UiResource, UiServiceEvent } from "@homelab-paas/shared-contracts";

import { ContainerLogs } from "../components/container-logs.tsx";
import { ResourceConfiguration } from "../components/resource-configuration.tsx";
import { ResourceState } from "../components/resource-state.tsx";
import { ServiceEvents } from "../components/service-events.tsx";
import { StatusBadge } from "../components/status-badge.tsx";
import type { ResourceTab } from "../types.ts";

export const ResourcePage = ({
	serviceId,
	resource,
	tab,
	containerId = resource.containers.at(0)?.id,
	logs,
	logError,
	events,
	eventError,
}: {
	serviceId: string;
	resource: UiResource;
	tab: ResourceTab;
	containerId?: string;
	logs?: UiLogs;
	logError?: string;
	events?: UiServiceEvent[];
	eventError?: string;
}) => {
	const base = `#/services/${serviceId}/resources/${resource.resourceId}`;
	const resourceEvents = events?.filter((event) => event.resourceId === resource.resourceId);
	return (
		<>
			<a className='back-link' href={`#/services/${serviceId}`}>
				← {serviceId}
			</a>
			<div className='page-heading'>
				<div>
					<p className='eyebrow'>{resource.type} resource</p>
					<div className='service-identity'>
						<h1>{resource.resourceId}</h1>
						<StatusBadge status={resource.health} />
					</div>
					<p>{resource.containers.length} observed containers · live updates</p>
					{resource.url && (
						<p>
							<a href={resource.url}>Open resource</a>
							{resource.primaryUrl && (
								<>
									{" "}
									· <a href={resource.primaryUrl}>Open primary service URL</a>
								</>
							)}
						</p>
					)}
				</div>
			</div>
			<nav className='tabs' aria-label='Resource inspection'>
				{(["config", "logs"] as const).map((value) => (
					<a key={value} href={`${base}/${value}`} aria-current={value === tab ? "page" : undefined}>
						{value === "config" ? "Overview" : "Logs"}
					</a>
				))}
				<a href={`${base}/events`}>Events</a>
			</nav>
			{tab === "config" && (
				<>
					<section className='recent-events' aria-label='Recent resource events'>
						<div className='section-heading'>
							<h2>Recent events</h2>
							{resourceEvents && resourceEvents.length > 2 && (
								<a href={`${base}/events`}>{resourceEvents.length - 2} more events...</a>
							)}
							{eventError && <a href={`${base}/events`}>Event history</a>}
						</div>
						<ServiceEvents events={resourceEvents?.slice(0, 2)} error={eventError} />
					</section>
					<div className='resource-overview'>
						<ResourceConfiguration config={resource.config} configYaml={resource.configYaml} />
						<ResourceState
							serviceId={serviceId}
							resourceId={resource.resourceId}
							containers={resource.containers}
						/>
					</div>
				</>
			)}
			{tab === "logs" && (
				<>
					<div className='log-toolbar'>
						<span className='muted'>Last 200 stdout / stderr lines</span>
					</div>
					{logError ? (
						<p role='alert' className='notice'>
							{logError}
						</p>
					) : !resource.containers.length ? (
						<p className='empty'>No containers available for logs.</p>
					) : !containerId ? (
						<p className='empty'>Select a container to inspect its logs.</p>
					) : (
						<ContainerLogs
							key={`${serviceId}/${resource.resourceId}/${containerId}`}
							content={logs?.content}
						/>
					)}
				</>
			)}
		</>
	);
};
