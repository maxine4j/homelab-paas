import type { UiHealthTimeline, UiServiceEvent } from "@homelab-paas/shared-contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

import { HealthTimeline } from "./health-timeline.tsx";

const now = 86_400_000;
const timeline: UiHealthTimeline = {
	observedAt: now,
	periods: [
		{ start: 0, end: 43_200_000, health: "Healthy" },
		{ start: 43_200_000, end: 43_201_000, health: "Progressing" },
		{ start: 43_201_000, end: now, health: "Healthy" },
	],
};

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

test("nearby events share a counted marker retaining the worst colour and all event details", () => {
	const html = renderToStaticMarkup(
		<HealthTimeline
			label='Health'
			now={now}
			events={[
				{ timestamp: 1000, level: "error", event: "reconciliation.failed", message: "Readiness failed" },
				{ timestamp: 2000, level: "info", event: "deployment.started", message: "Retry started" },
				{ timestamp: 3000, level: "info", event: "deployment.succeeded", message: "Retry succeeded" },
			]}
		/>,
	);
	expect(html.match(/class="health-marker /g)).toHaveLength(1);
	expect(html).toContain('class="health-marker health-degraded"');
	expect(html).toContain('data-count="3"');
	expect(html).toContain("Readiness failed");
	expect(html).toContain("Retry succeeded");
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
