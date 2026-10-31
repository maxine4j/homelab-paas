import type { UiServiceSummary } from "@homelab-paas/shared-contracts";

import { RevisionDetails } from "../components/revision-details.tsx";
import { StatusBadges } from "../components/status-badge.tsx";

export const ServicesPage = ({ services }: { services: UiServiceSummary[] }) => (
	<>
		<div className='page-heading'>
			<div>
				<p className='eyebrow'>Cluster overview</p>
				<h1>
					Services <span className='count'>{services.length}</span>
				</h1>
				<p>Configured services and their sync and health status.</p>
			</div>
		</div>
		{services.length === 0 ? (
			<p className='empty'>No services configured. Add a service to the cluster configuration.</p>
		) : (
			<div className='card-grid'>
				{services.map((service) => (
					<article className='card service-card' key={service.serviceId}>
						<div className='service-card-heading'>
							<h2>
								<a
									className='service-card-link'
									href={`#/services/${service.serviceId}`}
									title={service.serviceId}
								>
									{service.serviceId}
								</a>
							</h2>
							{service.primaryUrl && (
								<a
									className='primary-web-link'
									href={service.primaryUrl}
									target='_blank'
									rel='noreferrer'
									title={service.primaryUrl}
								>
									<span className='service-hostname'>{new URL(service.primaryUrl).host}</span>
									<span aria-hidden='true'>↗</span>
								</a>
							)}
							<StatusBadges health={service.health} sync={service.sync} />
						</div>
						<p className='service-description' title={service.description}>
							{service.description}
						</p>
						<dl className='service-revisions'>
							<div>
								<dt>Revision</dt>
								<RevisionDetails
									revision={service.activeRevision?.slice(0, 12)}
									metadata={service.activeRevisionMetadata}
									fallback='Not deployed'
									compact
								/>
							</div>
						</dl>
					</article>
				))}
			</div>
		)}
	</>
);
