import type { UiResource } from "@homelab-paas/shared-contracts";
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
	tab: "config" | "logs" | "events";
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
				{resource && (
					<>
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
					</>
				)}
			</div>
		</div>
		<ResourceDetailTabs serviceId={serviceId} resourceId={resourceId} tab={tab} />
		{children}
	</>
);
