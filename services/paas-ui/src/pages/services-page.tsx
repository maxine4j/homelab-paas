import type { UiServiceSummary } from "@homelab-paas/shared-contracts";

import { RevisionDetails } from "../components/revision-details.tsx";
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
					<article className='card service-card' key={service.serviceId}>
						<div className='card-top'>
							<h2>
								<a href={`#/services/${service.serviceId}`}>{service.serviceId}</a>
							</h2>
							<StatusBadge status={service.phase} />
						</div>
						<div className='service-card-bottom'>
							<div className='service-card-info'>
								{service.primaryUrl && (
									<a
										className='primary-web-link'
										href={service.primaryUrl}
										target='_blank'
										rel='noreferrer'
									>
										{new URL(service.primaryUrl).host} <span aria-hidden='true'>↗</span>
									</a>
								)}
								{service.description && <p>{service.description}</p>}
							</div>
							<dl className='service-revisions'>
								<div>
									<dt>Revision</dt>
									<RevisionDetails
										revision={service.activeRevision?.slice(0, 12)}
										metadata={service.activeRevisionMetadata}
										fallback='Not deployed'
									/>
								</div>
							</dl>
						</div>
					</article>
				))}
			</div>
		)}
	</>
);
