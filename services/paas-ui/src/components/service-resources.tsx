import type { UiResource, UiServiceEvent } from "@homelab-paas/shared-contracts";
import { ExternalLink, Globe, Lock } from "lucide-react";
import { useEffect, useState } from "react";

import { HealthTimelineView } from "./health-timeline.tsx";
import { StatusBadges } from "./status-badge.tsx";

const IngressAccess = ({ isPublic }: { isPublic: boolean }) => (
	<span className='ingress-access'>
		{isPublic ? <Globe aria-hidden='true' data-icon='globe' /> : <Lock aria-hidden='true' data-icon='lock' />}
		{isPublic ? "Public ingress" : "Private ingress"}
	</span>
);

interface ServiceResourcesProps {
	serviceId: string;
	resources: UiResource[];
	events?: UiServiceEvent[];
	eventError?: string;
}

export const ServiceResources = (props: ServiceResourcesProps) => {
	const [range, setRange] = useState<"day" | "hour">("day");
	const [clock, setClock] = useState(() => Date.now());
	useEffect(() => {
		const timer = window.setInterval(() => setClock(Date.now()), 30_000);
		return () => window.clearInterval(timer);
	}, []);
	const now = Math.max(
		clock,
		...props.resources.map((resource) => resource.healthTimeline?.observedAt ?? 0),
		...(props.events ?? []).map((event) => event.timestamp),
	);
	return <ServiceResourcesView {...props} range={range} onRangeChange={setRange} now={now} />;
};

export const ServiceResourcesView = ({
	serviceId,
	resources,
	events,
	eventError,
	range,
	onRangeChange,
	now,
}: ServiceResourcesProps & {
	range: "day" | "hour";
	onRangeChange: (range: "day" | "hour") => void;
	now: number;
}) => (
	<section aria-label='Service resources'>
		<div className='section-heading resource-list-heading'>
			<h2>
				Resources <span className='count'>{resources.length}</span>
			</h2>
			{resources.length > 0 && (
				<button type='button' className='muted' onClick={() => onRangeChange(range === "day" ? "hour" : "day")}>
					{range === "day" ? "Last 24 hours" : "Last hour"}
				</button>
			)}
		</div>
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
							<HealthTimelineView
								showLabel={false}
								range={range}
								now={now}
								label={`${resource.resourceId} health history`}
								timeline={resource.healthTimeline}
								events={events}
								eventError={eventError}
								resourceId={resource.resourceId}
							/>
						</article>
					);
				})}
			</div>
		)}
	</section>
);
