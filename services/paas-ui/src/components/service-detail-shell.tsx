import type { UiService } from "@homelab-paas/shared-contracts";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

import { ServiceDetailTabs } from "./detail-tabs.tsx";
import { StatusBadges } from "./status-badge.tsx";

export const ServiceDetailShell = ({
	serviceId,
	service,
	tab,
	children,
	actions,
}: {
	serviceId: string;
	service?: UiService;
	tab: "overview" | "resources" | "events" | "secrets" | "descriptor";
	children: ReactNode;
	actions?: ReactNode;
}) => {
	const primaryUrl = service?.resources.find(
		(resource) => (resource.type === "web" || resource.type === "static") && resource.primaryUrl,
	)?.primaryUrl;
	return (
		<>
			<div className='page-heading service-heading'>
				<div className='service-heading-content'>
					<div className='service-heading-row'>
						<div className='service-identity-block'>
							<div className='service-identity'>
								<h1>{serviceId}</h1>
								{service && <StatusBadges health={service.health} sync={service.sync} />}
							</div>
							{actions}
						</div>
						{primaryUrl && (
							<a className='primary-web-link' href={primaryUrl} target='_blank' rel='noreferrer'>
								{new URL(primaryUrl).host} <ExternalLink aria-hidden='true' />
							</a>
						)}
					</div>
				</div>
			</div>
			<ServiceDetailTabs serviceId={serviceId} tab={tab} />
			{children}
		</>
	);
};
