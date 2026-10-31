import type { UiResource } from "@homelab-paas/shared-contracts";

import { StatusBadge } from "./status-badge.tsx";

const IngressAccess = ({ isPublic }: { isPublic: boolean }) => (
	<span className='ingress-access'>
		<svg
			width='16'
			height='16'
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			strokeWidth='1.7'
			aria-hidden='true'
			data-icon={isPublic ? "globe" : "lock"}
		>
			{isPublic ? (
				<>
					<circle cx='12' cy='12' r='9' />
					<ellipse cx='12' cy='12' rx='4' ry='9' />
					<path d='M3 12h18' />
				</>
			) : (
				<>
					<rect x='5' y='10' width='14' height='11' rx='2' />
					<path d='M8 10V7a4 4 0 0 1 8 0v3' />
					<path d='M12 14v3' />
				</>
			)}
		</svg>
		{isPublic ? "Public ingress" : "Private ingress"}
	</span>
);

export const ServiceResources = ({ serviceId, resources }: { serviceId: string; resources: UiResource[] }) => (
	<section aria-label='Service resources'>
		<h2>
			Resources <span className='count'>{resources.length}</span>
		</h2>
		{!resources.length ? (
			<p className='empty'>No resources available.</p>
		) : (
			<div className='service-resource-list'>
				{resources.map((resource) => {
					const config =
						resource.config && typeof resource.config === "object" && !Array.isArray(resource.config)
							? resource.config
							: undefined;
					const ingress = config?.["ingress"];
					const isPublic =
						ingress && typeof ingress === "object" && !Array.isArray(ingress)
							? ingress["public"]
							: undefined;
					const image = config?.["image"];
					const url = resource.primaryUrl ?? resource.url;
					return (
						<article className='card service-resource-card' key={resource.resourceId}>
							<div className='card-top'>
								<div className='resource-card-identity'>
									<h3>
										<a
											className='resource-inspection-link'
											href={`#/services/${serviceId}/resources/${resource.resourceId}`}
										>
											{resource.resourceId}
										</a>
									</h3>
									<span className='eyebrow'>{resource.type}</span>
								</div>
								<StatusBadge status={resource.health} />
							</div>
							<div className='resource-card-image'>
								<span className='muted'>Image</span>
								<code>{typeof image === "string" ? image : "Image unavailable"}</code>
							</div>
							{resource.type === "web" && (
								<div className='resource-card-ingress'>
									{typeof isPublic === "boolean" ? (
										<IngressAccess isPublic={isPublic} />
									) : (
										<span className='muted'>Ingress access unavailable</span>
									)}
									{url && (
										<a href={url} target='_blank' rel='noreferrer'>
											{url} <span aria-hidden='true'>↗</span>
										</a>
									)}
								</div>
							)}
						</article>
					);
				})}
			</div>
		)}
	</section>
);
