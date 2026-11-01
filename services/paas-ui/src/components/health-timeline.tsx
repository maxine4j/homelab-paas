import type { HealthStatus, UiHealthTimeline, UiServiceEvent } from "@homelab-paas/shared-contracts";
import { useEffect, useState } from "react";

const day = 86_400_000;
const statuses: HealthStatus[] = ["Healthy", "Progressing", "Degraded", "Missing", "Unknown"];

interface HealthTimelineProps {
	label: string;
	timeline?: UiHealthTimeline;
	events?: UiServiceEvent[];
	resourceId?: string;
	now?: number;
	legend?: boolean;
	showLabel?: boolean;
	eventError?: string;
}

export const HealthTimeline = (props: HealthTimelineProps) => {
	const { now, timeline, events = [] } = props;
	const [clock, setClock] = useState(() => Date.now());
	const [range, setRange] = useState<"day" | "hour">("day");
	useEffect(() => {
		if (now !== undefined) return;
		const timer = window.setInterval(() => setClock(Date.now()), 30_000);
		return () => window.clearInterval(timer);
	}, [now]);
	const end = now ?? Math.max(clock, timeline?.observedAt ?? 0, ...events.map(({ timestamp }) => timestamp));
	return <HealthTimelineView {...props} now={end} range={range} onRangeChange={setRange} />;
};

export const HealthTimelineView = ({
	label,
	timeline,
	events = [],
	resourceId,
	now: end,
	legend = false,
	showLabel = true,
	eventError,
	range,
	onRangeChange,
}: HealthTimelineProps & {
	now: number;
	range: "day" | "hour";
	onRangeChange?: (range: "day" | "hour") => void;
}) => {
	const duration = range === "day" ? day : 3_600_000;
	const start = end - duration;
	const position = (at: number) => `${Math.max(0, Math.min(100, ((at - start) / duration) * 100))}%`;
	const alignment = (at: number) =>
		at < start + duration * 0.25 ? "start" : at > start + duration * 0.75 ? "end" : undefined;
	const periods =
		timeline?.periods.flatMap((period, index) => {
			const until =
				index === timeline.periods.length - 1
					? Math.max(period.end, Math.min(end, timeline.observedAt + 90_000))
					: period.end;
			if (until <= start || period.start >= end) return [];
			return [{ ...period, start: Math.max(start, period.start), end: Math.min(end, until) }];
		}) ?? [];
	const markers = events.filter(
		(event) =>
			event.timestamp >= start
			&& event.timestamp <= end
			&& (resourceId === undefined || event.resourceId === resourceId),
	);
	const groups: UiServiceEvent[][] = [];
	for (const event of markers.sort((a, b) => a.timestamp - b.timestamp)) {
		const last = groups.at(-1);
		if (last && event.timestamp - last[0]!.timestamp < duration * 0.02) last.push(event);
		else groups.push([event]);
	}
	return (
		<figure className='health-timeline' aria-label={label}>
			{(showLabel || onRangeChange) && (
				<figcaption>
					{showLabel && <span>{label}</span>}
					{onRangeChange && (
						<button
							type='button'
							className='muted'
							onClick={() => onRangeChange(range === "day" ? "hour" : "day")}
						>
							{range === "day" ? "Last 24 hours" : "Last hour"}
						</button>
					)}
				</figcaption>
			)}
			<div className='health-track' aria-label='Unobserved time is Unknown'>
				{periods.map((period, index) => {
					const description = `${period.health}: ${new Date(period.start).toLocaleString()} – ${new Date(period.end).toLocaleString()}`;
					const width = ((period.end - period.start) / duration) * 100;
					return (
						<span
							key={`${period.start}-${index}`}
							className={`health-period health-${period.health.toLowerCase()}`}
							style={{ left: position(period.start), width: `${width}%` }}
							tabIndex={0}
							role='img'
							aria-label={description}
							data-tooltip={description}
							data-align={alignment((period.start + period.end) / 2)}
						/>
					);
				})}
				{periods
					.filter((period) => (period.end - period.start) / duration < 0.005)
					.map((period, index) => {
						const description = `${period.health}: ${new Date(period.start).toLocaleString()} – ${new Date(period.end).toLocaleString()}`;
						return (
							<span
								key={`short-${period.start}-${index}`}
								className={`health-marker health-${period.health.toLowerCase()}`}
								style={{ left: position(period.start) }}
								tabIndex={0}
								role='img'
								aria-label={description}
								data-tooltip={description}
								data-align={alignment(period.start)}
							/>
						);
					})}
				{groups.map((group, index) => {
					const event = group[0]!;
					const health: HealthStatus = group.some((entry) => entry.level === "error")
						? "Degraded"
						: group.some((entry) => entry.event === "deployment.started")
							? "Progressing"
							: "Healthy";
					const description = group
						.map(
							(entry) =>
								`${new Date(entry.timestamp).toLocaleString()} · ${entry.event}${entry.resourceId ? ` · ${entry.resourceId}` : ""}: ${entry.message}`,
						)
						.join("\n");
					return (
						<span
							key={`event-${event.timestamp}-${index}`}
							className={`health-marker health-${health.toLowerCase()}`}
							style={{ left: position(event.timestamp) }}
							tabIndex={0}
							role='img'
							aria-label={description}
							data-count={group.length > 1 ? group.length : undefined}
							data-align={alignment(event.timestamp)}
							data-tooltip={description}
						/>
					);
				})}
			</div>
			<div className='health-axis'>
				<span>
					{new Date(start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{" "}
					{range === "day" ? "yesterday" : "1 hour ago"}
				</span>
				<span>Now</span>
			</div>
			{!timeline && <p className='muted'>Health history unavailable.</p>}
			{timeline && timeline.observedAt + 90_000 < end && (
				<p className='muted'>Latest observation: {new Date(timeline.observedAt).toLocaleString()}</p>
			)}
			{eventError && <p className='muted'>Event markers unavailable.</p>}
			{legend && (
				<div className='health-legend'>
					{statuses.map((health) => (
						<span key={health}>
							<i className={`health-${health.toLowerCase()}`} aria-hidden='true' />
							{health}
						</span>
					))}
				</div>
			)}
		</figure>
	);
};
