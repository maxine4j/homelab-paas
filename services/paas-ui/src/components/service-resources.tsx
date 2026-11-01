import type { UiResource } from "@homelab-paas/shared-contracts";
import { ExternalLink, Globe, Lock } from "lucide-react";

import { StatusBadges } from "./status-badge.tsx";

const IngressAccess = ({ isPublic }: { isPublic: boolean }) => (
	<span className='ingress-access'>
		{isPublic ? <Globe aria-hidden='true' data-icon='globe' /> : <Lock aria-hidden='true' data-icon='lock' />}
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
					const path = config?.["path"];
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
								<StatusBadges health={resource.health} sync={resource.sync} />
							</div>
							<div className='resource-card-image'>
								<span className='muted'>{resource.type === "static" ? "Path" : "Image"}</span>
								<code>
									{resource.type === "static"
										? typeof path === "string"
											? path
											: "Path unavailable"
										: typeof image === "string"
											? image
											: "Image unavailable"}
								</code>
							</div>
							{(resource.type === "web" || resource.type === "static") && (
								<div className='resource-card-ingress'>
									{typeof isPublic === "boolean" ? (
										<IngressAccess isPublic={isPublic} />
									) : (
										<span className='muted'>Ingress access unavailable</span>
									)}
									{url && (
										<a href={url} target='_blank' rel='noreferrer'>
											{url} <ExternalLink aria-hidden='true' />
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
