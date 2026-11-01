import type { UiResource } from "@homelab-paas/shared-contracts";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

import { ResourceDetailTabs } from "./detail-tabs.tsx";
import { StatusBadges } from "./status-badge.tsx";

export const ResourceDetailShell = ({
	serviceId,
	resourceId,
	resource,
	tab,
	children,
}: {
	serviceId: string;
	resourceId: string;
	resource?: UiResource;
	tab: "config" | "descriptor" | "logs" | "events";
	children: ReactNode;
}) => (
	<>
		<div className='page-heading'>
			<div>
				{resource && <p className='eyebrow'>{resource.type} resource</p>}
				<div className='service-identity'>
					<h1>{resourceId}</h1>
					{resource && <StatusBadges health={resource.health} sync={resource.sync} />}
				</div>
				<div className='resource-ingress-links'>
					{[...new Set([resource?.primaryUrl, resource?.url])]
						.filter((url) => url !== undefined)
						.map((url) => (
							<a key={url} className='primary-web-link' href={url} target='_blank' rel='noreferrer'>
								{url} <ExternalLink aria-hidden='true' />
							</a>
						))}
				</div>
			</div>
		</div>
		<ResourceDetailTabs serviceId={serviceId} resourceId={resourceId} tab={tab} />
		{children}
	</>
);
