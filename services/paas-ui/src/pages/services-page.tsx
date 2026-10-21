import type { UiServiceSummary } from "@homelab-paas/shared-contracts";

import { StatusBadge } from "../components/status-badge.tsx";

export const ServicesPage = ({ services }: { services: UiServiceSummary[] }) => (
	<>
		<div className='page-heading'>
			<div>
				<p className='eyebrow'>Cluster overview</p>
				<h1>
					Services <span className='count'>{services.length}</span>
				</h1>
				<p>Configured services and their latest deployment status.</p>
			</div>
		</div>
		{services.length === 0 ? (
			<p className='empty'>No services configured. Add a service to the cluster configuration.</p>
		) : (
			<div className='card-grid'>
				{services.map((service) => (
					<a className='card resource-link' key={service.serviceId} href={`#/services/${service.serviceId}`}>
						<div className='card-top'>
							<span className='eyebrow'>Service</span>
							<StatusBadge status={service.phase} />
						</div>
						<h2>{service.serviceId}</h2>
						<dl>
							<dt>Active revision</dt>
							<dd>{service.activeRevision?.slice(0, 12) ?? "Not deployed"}</dd>
							<dt>Desired revision</dt>
							<dd>{service.desiredRevision?.slice(0, 12) ?? "Not observed"}</dd>
						</dl>
						<span className='card-action'>
							View resources <span aria-hidden='true'>↗</span>
						</span>
					</a>
				))}
			</div>
		)}
	</>
);
