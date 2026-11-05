import type { HealthStatus, UiHealthPeriod, UiHealthTimeline, UiServiceEvent } from "@homelab-paas/shared-contracts";
import { type CSSProperties, useEffect, useRef, useState } from "react";

import type { HealthTimelineMarker } from "../types.ts";
import { layoutHealthMarkers } from "./health-timeline-layout.ts";

const day = 86_400_000;
const statuses: HealthStatus[] = ["Healthy", "Progressing", "Degraded", "Missing", "Unknown", "Paused"];
const formatTime = (at: number) =>
	new Date(at)
		.toLocaleTimeString("en-US", {
			hour: "numeric",
			minute: "2-digit",
			hour12: true,
		})
		.toLowerCase();
const periodDescription = (period: UiHealthPeriod) =>
	`${period.health}: ${formatTime(period.start)} – ${formatTime(period.end)}`;

const MarkerTooltip = ({ markers, style }: { markers: HealthTimelineMarker[]; style?: CSSProperties }) => {
	const entries: HealthTimelineMarker[][] = [];
	for (const marker of markers) {
		const last = entries.at(-1);
		const event = marker.event;
		const previous = last?.at(-1)?.event;
		if (
			event?.level === "error"
			&& previous?.level === "error"
			&& event.event === previous.event
			&& event.message === previous.message
			&& event.resourceId === previous.resourceId
		)
			last!.push(marker);
		else entries.push([marker]);
	}
	return (
		<span className='health-tooltip' role='tooltip' style={style}>
			{entries.map((entry, index) => {
				const marker = entry.at(0)!;
				const event = marker.event;
				return (
					<span className='health-tooltip-entry' key={index}>
						<span>
							{event
								? `${entry.length > 1 ? `${entry.length}× ` : ""}${event.event}${event.resourceId ? ` · ${event.resourceId}` : ""}: ${event.message}`
								: periodDescription(marker.period!)}
						</span>
						{event && (
							<span className='health-tooltip-times'>
								{entry.map(({ timestamp }, timeIndex) => (
									<time key={timeIndex} dateTime={new Date(timestamp).toISOString()}>
										{formatTime(timestamp)}
									</time>
								))}
							</span>
						)}
					</span>
				);
			})}
		</span>
	);
};

const HealthMarker = ({ markers, alignment }: { markers: HealthTimelineMarker[]; alignment?: string }) => {
	const element = useRef<HTMLSpanElement>(null);
	const [anchor, setAnchor] = useState<CSSProperties>();
	const updateAnchor = () => {
		const rect = element.current?.getBoundingClientRect();
		if (!rect) return;
		const width = Math.min(420, window.innerWidth - 32);
		setAnchor({
			position: "fixed",
			left: Math.max(16, Math.min(window.innerWidth - width - 16, rect.left + rect.width / 2 - width / 2)),
			right: "auto",
			bottom: window.innerHeight - rect.top + 12,
			width,
			transform: "none",
		});
	};
	const active = anchor !== undefined;
	useEffect(() => {
		if (!active) return;
		window.addEventListener("scroll", updateAnchor, true);
		window.addEventListener("resize", updateAnchor);
		return () => {
			window.removeEventListener("scroll", updateAnchor, true);
			window.removeEventListener("resize", updateAnchor);
		};
	}, [active]);
	const count = markers.filter(({ event }) => event).length || markers.length;
	const description = markers
		.map((marker) =>
			marker.event
				? `${formatTime(marker.timestamp)} · ${marker.event.event}${marker.event.resourceId ? ` · ${marker.event.resourceId}` : ""}: ${marker.event.message}`
				: periodDescription(marker.period!),
		)
		.join("\n");
	return (
		<span
			ref={element}
			className={`health-marker health-${markers.at(0)!.health.toLowerCase()}`}
			tabIndex={0}
			role='img'
			aria-label={description}
			data-count={count > 1 ? count : undefined}
			data-align={alignment}
			onMouseEnter={updateAnchor}
			onFocus={updateAnchor}
			onMouseLeave={() => {
				if (document.activeElement !== element.current) setAnchor(undefined);
			}}
			onBlur={() => setAnchor(undefined)}
		>
			<MarkerTooltip markers={markers} style={anchor} />
		</span>
	);
};

const HealthTrack = ({
	periods,
	events,
	start,
	duration,
}: {
	periods: UiHealthPeriod[];
	events: UiServiceEvent[];
	start: number;
	duration: number;
}) => {
	const track = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(640);
	useEffect(() => {
		const element = track.current;
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => {
			if (entry && entry.contentRect.width > 0) setWidth(entry.contentRect.width);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const position = (at: number) => `${Math.max(0, Math.min(100, ((at - start) / duration) * 100))}%`;
	const alignment = (fraction: number) => (fraction < 0.25 ? "start" : fraction > 0.75 ? "end" : undefined);
	const markers: HealthTimelineMarker[] = [
		...periods
			.filter((period) => (period.end - period.start) / duration < 0.005)
			.map((period) => ({ timestamp: period.start, health: period.health, period })),
		...events.map((event): HealthTimelineMarker => ({
			timestamp: event.timestamp,
			health:
				event.level === "error" ? "Degraded" : event.event === "deployment.started" ? "Progressing" : "Healthy",
			event,
		})),
	];
	return (
		<div className='health-track' ref={track} aria-label='Unobserved time is Unknown'>
			<div className='health-periods'>
				{periods.map((period, index) => (
					<span
						key={`${period.start}-${index}`}
						className={`health-period health-${period.health.toLowerCase()}`}
						style={{
							left: position(period.start),
							width: `${((period.end - period.start) / duration) * 100}%`,
						}}
						tabIndex={0}
						role='img'
						aria-label={periodDescription(period)}
						data-tooltip={periodDescription(period)}
						data-align={alignment(((period.start + period.end) / 2 - start) / duration)}
					/>
				))}
			</div>
			<div className='health-markers'>
				{layoutHealthMarkers(markers, start, duration, width).map((cluster, index) => {
					const style: CSSProperties & { "--health-marker-scale": number } = {
						left: `${(cluster.left / width) * 100}%`,
						width: cluster.width,
						"--health-marker-scale": cluster.markerScale,
					};
					return (
						<div
							key={index}
							className={cluster.markers.length > 1 ? "health-cluster" : "health-single"}
							style={style}
						>
							{cluster.groups.map((group) => (
								<HealthMarker
									key={group.at(0)!.health}
									markers={group}
									alignment={alignment((cluster.left + cluster.width / 2) / width)}
								/>
							))}
						</div>
					);
				})}
			</div>
		</div>
	);
};

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
			<HealthTrack periods={periods} events={markers} start={start} duration={duration} />
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
