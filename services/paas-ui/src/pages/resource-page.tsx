import type { UiLogs, UiResource, UiServiceEvent } from "@homelab-paas/shared-contracts";

import { ContainerLogs } from "../components/container-logs.tsx";
import { ResourceConfiguration } from "../components/resource-configuration.tsx";
import { ResourceDetailShell } from "../components/resource-detail-shell.tsx";
import { ResourceState } from "../components/resource-state.tsx";
import { ServiceEvents } from "../components/service-events.tsx";
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
		<ResourceDetailShell serviceId={serviceId} resourceId={resource.resourceId} resource={resource} tab={tab}>
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
						<ServiceEvents serviceId={serviceId} events={resourceEvents?.slice(0, 2)} error={eventError} />
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
		</ResourceDetailShell>
	);
};
