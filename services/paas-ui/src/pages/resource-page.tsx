import type { UiLogs, UiResource } from "@homelab-paas/shared-contracts";

import { ContainerLogs } from "../components/container-logs.tsx";
import { ResourceConfiguration } from "../components/resource-configuration.tsx";
import { ResourceState } from "../components/resource-state.tsx";
import type { ResourceTab } from "../types.ts";

export const ResourcePage = ({
	serviceId,
	resource,
	tab,
	containerId = resource.containers.at(0)?.id,
	logs,
	logError,
}: {
	serviceId: string;
	resource: UiResource;
	tab: ResourceTab;
	containerId?: string;
	logs?: UiLogs;
	logError?: string;
}) => {
	const base = `#/services/${serviceId}/resources/${resource.resourceId}`;
	return (
		<>
			<a className='back-link' href={`#/services/${serviceId}`}>
				← {serviceId}
			</a>
			<div className='page-heading'>
				<div>
					<p className='eyebrow'>{resource.type} resource</p>
					<h1>{resource.resourceId}</h1>
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
			</nav>
			{tab === "config" && (
				<div className='resource-overview'>
					<ResourceConfiguration config={resource.config} configYaml={resource.configYaml} />
					<ResourceState
						serviceId={serviceId}
						resourceId={resource.resourceId}
						containers={resource.containers}
					/>
				</div>
			)}
			{tab === "logs" && (
				<>
					<div className='log-toolbar'>
						<label>
							Container{" "}
							<select
								value={containerId ?? ""}
								onChange={(event) => {
									window.location.hash = `${base}/logs/${encodeURIComponent(event.target.value)}`;
								}}
							>
								<option value='' disabled>
									Select a container
								</option>
								{resource.containers.map((container) => (
									<option key={container.id} value={container.id}>
										{container.id.slice(0, 12)} · {container.state}
									</option>
								))}
							</select>
						</label>
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
