import type { UiService } from "@homelab-paas/shared-contracts";
import type { ReactNode } from "react";

import { ServiceDetailTabs } from "./detail-tabs.tsx";
import { gitCommitLink } from "./git-source-link.ts";
import { ServiceRevision } from "./service-revision.tsx";
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
		(resource) => resource.type === "web" && resource.primaryUrl,
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
								{new URL(primaryUrl).host} <span aria-hidden='true'>↗</span>
							</a>
						)}
						{service && (
							<div className='service-commit-panels'>
								<ServiceRevision
									label='Active revision'
									revision={service.activeRevision}
									href={gitCommitLink(service.source, service.activeRevision)}
									metadata={service.activeRevisionMetadata}
									fallback='Not deployed'
								/>
								<ServiceRevision
									label='Desired revision'
									revision={service.descriptorRevision}
									href={gitCommitLink(service.source, service.descriptorRevision)}
									metadata={service.descriptorRevisionMetadata}
									fallback='Unavailable'
								/>
							</div>
						)}
					</div>
				</div>
			</div>
			<ServiceDetailTabs serviceId={serviceId} tab={tab} />
			{children}
		</>
	);
};
