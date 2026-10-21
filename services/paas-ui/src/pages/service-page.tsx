import type { UiService } from "@homelab-paas/shared-contracts";

import { ConfigView } from "../components/config-view.tsx";
import { StatusBadge } from "../components/status-badge.tsx";

export const ServicePage = ({ service }: { service: UiService }) => (
	<>
		<a className='back-link' href='#/services'>
			← Services
		</a>
		<div className='page-heading'>
			<div>
				<p className='eyebrow'>Service</p>
				<h1>{service.serviceId}</h1>
				<p>Desired resources alongside observed containers.</p>
			</div>
			<StatusBadge status={service.phase} />
		</div>
		{service.descriptorStatus === "unavailable" && (
			<p className='notice' role='status'>
				Descriptor unavailable. Showing observed resources; desired configuration could not be loaded.
			</p>
		)}
		<dl className='summary'>
			<div>
				<dt>Active revision</dt>
				<dd>{service.activeRevision ?? "Not deployed"}</dd>
			</div>
			<div>
				<dt>Descriptor revision</dt>
				<dd>{service.descriptorRevision ?? "Unavailable"}</dd>
			</div>
			{service.retryAt && (
				<div>
					<dt>Next retry</dt>
					<dd>{new Date(service.retryAt).toLocaleString()}</dd>
				</div>
			)}
		</dl>
		<h2>
			Resources <span className='count'>{service.resources.length}</span>
		</h2>
		<div className='card-grid'>
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
					<span className='card-action'>Inspect resource ↗</span>
				</a>
			))}
		</div>
		<details>
			<summary>Service source configuration</summary>
			<ConfigView value={service.source} />
		</details>
	</>
);
