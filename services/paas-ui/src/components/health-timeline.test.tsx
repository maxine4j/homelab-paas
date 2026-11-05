import type { UiHealthTimeline, UiServiceEvent } from "@homelab-paas/shared-contracts";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

import { HealthTimeline, HealthTimelineView } from "./health-timeline.tsx";

const now = 86_400_000;
const timeline: UiHealthTimeline = {
	observedAt: now,
	periods: [
		{ start: 0, end: 43_200_000, health: "Healthy" },
		{ start: 43_200_000, end: 43_201_000, health: "Progressing" },
		{ start: 43_201_000, end: now, health: "Healthy" },
	],
};

test("controlled timelines can omit their individual range button", () => {
	const html = renderToStaticMarkup(<HealthTimelineView label='Health' now={now} range='hour' timeline={timeline} />);
	expect(html).not.toContain("<button");
	expect(html).toContain("1 hour ago");
});

test("offers a native range button and lists only health statuses in the legend", () => {
	const html = renderToStaticMarkup(<HealthTimeline label='Health' now={now} legend />);
	expect(html).toContain('<button type="button"');
	expect(html).toContain(">Last 24 hours</button>");
	expect(html).not.toContain("Brief transitions / events");
	for (const status of ["Healthy", "Progressing", "Degraded", "Missing", "Unknown", "Paused"]) {
		expect(html).toContain(status);
	}
});

test("range button switches the plotted window, markers and axis to the last hour and back", () => {
	const hour = 3_600_000;
	const selection: { range: "day" | "hour" } = { range: "day" };
	const render = () =>
		HealthTimelineView({
			label: "Health",
			now,
			range: selection.range,
			onRangeChange: (range) => {
				selection.range = range;
			},
			timeline: {
				observedAt: now,
				periods: [
					{ start: now - hour * 2, end: now - hour, health: "Degraded" },
					{ start: now - hour, end: now - hour / 2, health: "Healthy" },
					{ start: now - hour / 2, end: now - hour / 2 + 30_000, health: "Progressing" },
					{ start: now - hour / 2 + 30_000, end: now, health: "Healthy" },
				],
			},
			events: [
				{ timestamp: now - hour * 2, level: "info", event: "deployment.succeeded", message: "Older rollout" },
				{ timestamp: now - hour / 2, level: "info", event: "deployment.started", message: "Recent start" },
				{
					timestamp: now - hour / 2 + 120_000,
					level: "info",
					event: "deployment.succeeded",
					message: "Recent finish",
				},
			],
		});
	const click = (view: ReturnType<typeof render>) => {
		const caption = view.props.children[0] as ReactElement<{ children: ReactNode }>;
		const button = Children.toArray(caption.props.children).find(
			(child) => isValidElement(child) && child.type === "button",
		);
		if (!isValidElement<{ onClick: () => void }>(button)) throw new Error("Missing range button");
		button.props.onClick();
	};
	const day = render();
	const dayHtml = renderToStaticMarkup(day);
	expect(dayHtml).toContain("Last 24 hours");
	expect(dayHtml).toContain("yesterday");
	expect(dayHtml).toContain("Older rollout");
	expect(dayHtml).toContain('class="health-cluster"');
	expect(dayHtml).toContain('class="health-marker health-progressing"');
	click(day);
	expect(selection.range).toBe("hour");
	const lastHour = render();
	const hourHtml = renderToStaticMarkup(lastHour);
	expect(hourHtml).toContain("Last hour");
	expect(hourHtml).toContain("width:50%");
	expect(hourHtml).not.toContain('class="health-period health-degraded"');
	expect(hourHtml).not.toContain("Older rollout");
	expect(hourHtml).not.toContain('data-count="2"');
	expect(hourHtml).toContain("Recent start");
	expect(hourHtml).toContain("Recent finish");
	expect(hourHtml).toContain("left:50%");
	expect(hourHtml).not.toContain("yesterday");
	expect(hourHtml).toContain(
		`${new Date(now - hour).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} 1 hour ago`,
	);
	// The 30-second observation is visible as a period, rather than a brief-transition circle at this scale.
	expect(hourHtml.match(/class="health-marker health-progressing"/g)).toHaveLength(1);
	click(lastHour);
	expect(selection.range).toBe("day");
	expect(renderToStaticMarkup(render())).toBe(dayHtml);
});

test("immediate events use the render time instead of waiting for the next display-clock tick", () => {
	const clock = vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValue(2000);
	try {
		const html = renderToStaticMarkup(
			<HealthTimeline
				label='Health'
				events={[{ timestamp: 1500, level: "info", event: "deployment.started", message: "Just started" }]}
			/>,
		);
		expect(html).toContain("Just started");
	} finally {
		clock.mockRestore();
	}
});

test("renders proportional health intervals and a keyboard-accessible circle for brief progress", () => {
	const html = renderToStaticMarkup(<HealthTimeline label='Service health' timeline={timeline} now={now} />);
	expect(html).toContain('aria-label="Service health"');
	expect(html).toContain('class="health-period health-healthy"');
	expect(html).toContain("width:50%");
	expect(html).toContain('class="health-marker health-progressing"');
	expect(html).toContain('tabindex="0"');
	expect(html).toContain("Progressing:");
	expect(html).toContain("Last 24 hours");
});

test("preserves unknown gaps and does not extend stale or future observations", () => {
	const html = renderToStaticMarkup(
		<HealthTimeline
			label='Health'
			now={now}
			timeline={{
				observedAt: 43_200_000,
				periods: [
					{ start: 0, end: 20_000_000, health: "Healthy" },
					{ start: 40_000_000, end: 43_200_000, health: "Degraded" },
				],
			}}
		/>,
	);
	expect(html).toContain("Unobserved time is Unknown");
	expect(html).toContain('class="health-period health-degraded"');
	expect(html).toContain("Latest observation:");
	expect(html).not.toContain("width:100%");
	expect(renderToStaticMarkup(<HealthTimeline label='Health' now={now} />)).toContain("Health history unavailable");
});

test("overlays event circles within the window and filters resource events by exact identity", () => {
	const events: UiServiceEvent[] = [
		{
			timestamp: 43_200_000,
			level: "info",
			event: "deployment.started",
			message: "Starting app",
			resourceId: "app",
		},
		{
			timestamp: 43_200_100,
			level: "error",
			event: "reconciliation.failed",
			message: "Other failed",
			resourceId: "other",
		},
		{ timestamp: 43_200_200, level: "error", event: "reconciliation.failed", message: "Service failed" },
		{ timestamp: -100, level: "info", event: "deployment.succeeded", message: "Too old", resourceId: "app" },
	];
	const html = renderToStaticMarkup(
		<HealthTimeline label='App health' timeline={timeline} now={now} events={events} resourceId='app' />,
	);
	expect(html).toContain("Starting app");
	expect(html).not.toContain("Other failed");
	expect(html).not.toContain("Service failed");
	expect(html).not.toContain("Too old");
	const service = renderToStaticMarkup(
		<HealthTimeline label='Service health' timeline={timeline} now={now} events={events} />,
	);
	expect(service).toContain("Other failed");
	expect(service).toContain("Service failed");
	expect(service).toContain('class="health-marker health-degraded"');
});

test("nearby events share a pill with one dot per colour in order of first appearance", () => {
	const html = renderToStaticMarkup(
		<HealthTimeline
			label='Health'
			now={now}
			events={[
				{ timestamp: 1000, level: "info", event: "deployment.started", message: "Initial rollout" },
				{ timestamp: 2000, level: "error", event: "reconciliation.failed", message: "Readiness failed" },
				{ timestamp: 3000, level: "error", event: "reconciliation.failed", message: "Readiness failed" },
				{ timestamp: 4000, level: "info", event: "deployment.started", message: "Retry started" },
				{ timestamp: 5000, level: "info", event: "deployment.succeeded", message: "Recovered" },
				{ timestamp: 6000, level: "error", event: "reconciliation.failed", message: "Readiness failed" },
				{ timestamp: 7000, level: "info", event: "deployment.started", message: "Retry started again" },
				{ timestamp: 8000, level: "info", event: "deployment.started", message: "Latest rollout" },
			]}
		/>,
	);
	expect(html).toContain('class="health-cluster"');
	const dots = html.match(/<span class="health-marker [^"]+"[^>]*>/g);
	expect(dots).toEqual([
		expect.stringMatching(/class="health-marker health-progressing".*data-count="4"/s),
		expect.stringMatching(/class="health-marker health-degraded".*data-count="3"/s),
		expect.stringMatching(/class="health-marker health-healthy"/),
	]);
	expect(dots?.at(2)).not.toContain("data-count");
	expect(html).toContain("Initial rollout");
	expect(html).toContain("Readiness failed");
	expect(html).toContain("Retry started again");
	expect(html).toContain("Recovered");
});

test("clusters dots with less than a diameter of clear space, including brief health periods", () => {
	const html = renderToStaticMarkup(
		<HealthTimeline
			label='Health'
			now={now}
			timeline={timeline}
			events={[
				{
					timestamp: 43_200_000 + now * 0.03,
					level: "error",
					event: "reconciliation.failed",
					message: "Nearby",
				},
			]}
		/>,
	);
	expect(html).toContain('class="health-cluster"');
});

test("tooltips collapse identical consecutive errors and show separate non-wrapping 12-hour times", () => {
	const timestamp = new Date(2026, 10, 4, 16, 6, 7).getTime();
	const html = renderToStaticMarkup(
		<HealthTimeline
			label='Health'
			now={timestamp + 60_000}
			events={[
				{ timestamp, level: "error", event: "reconciliation.failed", message: "Readiness failed" },
				{
					timestamp: timestamp + 1000,
					level: "error",
					event: "reconciliation.failed",
					message: "Readiness failed",
				},
				{
					timestamp: timestamp + 2000,
					level: "error",
					event: "reconciliation.failed",
					message: "Different error",
				},
			]}
		/>,
	);
	expect(html).toContain("2× reconciliation.failed: Readiness failed");
	expect(html).toContain('class="health-tooltip-entry"');
	expect(html).toContain('<time dateTime="2026-');
	expect(html).toContain(">4:06 pm</time>");
	expect(html).not.toContain("4:06:07");
	expect(html).not.toContain("04/11/2026");
	expect(html).toContain("Different error");
});

test("anchors details inside the track at both edges so phone tooltips remain readable", () => {
	const html = renderToStaticMarkup(
		<HealthTimeline
			label='Health'
			now={now}
			events={[
				{ timestamp: 1, level: "info", event: "deployment.started", message: "Start edge" },
				{ timestamp: now - 1, level: "error", event: "reconciliation.failed", message: "End edge" },
			]}
		/>,
	);
	expect(html).toContain('data-align="start"');
	expect(html).toContain('data-align="end"');
});
