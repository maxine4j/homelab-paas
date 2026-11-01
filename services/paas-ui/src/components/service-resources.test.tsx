import type { UiResource } from "@homelab-paas/shared-contracts";
import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ServicePage } from "../pages/service-page.tsx";
import { ServiceResourcesView } from "./service-resources.tsx";

test("one heading button switches every resource timeline to the same window and back", () => {
	const now = 86_400_000;
	const resources: UiResource[] = ["app", "db"].map((resourceId) => ({
		resourceId,
		type: "worker",
		health: "Healthy",
		sync: "Synced",
		containers: [],
		healthTimeline: { observedAt: now, periods: [{ start: now - 1_800_000, end: now, health: "Healthy" }] },
	}));
	let range: "day" | "hour" = "day";
	const render = () =>
		ServiceResourcesView({
			serviceId: "demo",
			resources,
			now,
			range,
			onRangeChange: (next) => {
				range = next;
			},
		});
	const click = (node: ReactNode): boolean => {
		for (const child of Children.toArray(node)) {
			if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(child)) continue;
			if (child.type === "button") {
				child.props.onClick?.();
				return true;
			}
			if (click(child.props.children)) return true;
		}
		return false;
	};
	const day = renderToStaticMarkup(render());
	expect(day.match(/<button/g)).toHaveLength(1);
	expect(day).not.toContain("<figcaption>");
	expect(day).toContain('aria-label="app health history"');
	expect(day).toMatch(
		/class="section-heading resource-list-heading"[^]*?Resources[^]*?Last 24 hours[^]*?<\/button><\/div>/,
	);
	expect(day.match(/yesterday/g)).toHaveLength(2);
	expect(click(render())).toBe(true);
	expect(range).toBe("hour");
	const hour = renderToStaticMarkup(render());
	expect(hour.match(/1 hour ago/g)).toHaveLength(2);
	expect(hour.match(/width:50%/g)).toHaveLength(2);
	expect(hour).toContain("Last hour");
	expect(click(render())).toBe(true);
	expect(renderToStaticMarkup(render())).toBe(day);
});

const renderResources = (resources: UiResource[]) =>
	renderToStaticMarkup(
		<ServicePage
			tab='resources'
			service={{
				serviceId: "metrics",
				sync: "Synced",
				health: "Healthy",
				source: {},
				descriptorStatus: "available",
				resources,
			}}
		/>,
	);

test("resource rows each include their own health timeline", () => {
	const html = renderResources([
		{
			resourceId: "app",
			type: "worker",
			sync: "Synced",
			health: "Healthy",
			containers: [],
			healthTimeline: { observedAt: Date.now(), periods: [] },
		},
	]);
	expect(html).toContain('aria-label="app health history"');
});

test("static cards show the bundle path and ingress link without an image placeholder", () => {
	const html = renderResources([
		{
			resourceId: "site",
			type: "static",
			sync: "Synced",
			health: "Healthy",
			primaryUrl: "https://metrics.example.test",
			config: { path: "/dist", ingress: { public: false } },
			containers: [],
		},
	]);
	expect(html).toContain("/dist");
	expect(html).toContain('class="primary-web-link"');
	expect(html).toContain("Private ingress");
	expect(html).toContain('href="https://metrics.example.test" target="_blank"');
	expect(html).not.toContain("Image unavailable");
});

test.each([true, false])(
	"web cards prefer the primary ingress link, %s access, health and the configured image",
	(isPublic) => {
		const html = renderResources([
			{
				resourceId: "grafana",
				type: "web",
				sync: "Synced",
				health: "Healthy",
				url: "https://grafana.metrics.example.test",
				primaryUrl: "https://metrics.example.test",
				config: {
					image: "ghcr.io/maxine4j/homelab-paas/metrics-grafana:latest",
					ingress: { public: isPublic, port: 3000 },
				},
				containers: [],
			},
		]);
		expect(html).toContain('href="#/services/metrics/resources/grafana"');
		expect(html).not.toContain('href="https://grafana.metrics.example.test"');
		expect(html).toContain('href="https://metrics.example.test" target="_blank" rel="noreferrer"');
		expect(html).toContain(isPublic ? "Public ingress" : "Private ingress");
		expect(html).toContain(isPublic ? 'data-icon="globe"' : 'data-icon="lock"');
		expect(html).toContain("badge-healthy");
		expect(html).toContain("ghcr.io/maxine4j/homelab-paas/metrics-grafana:latest");
		expect(html).not.toMatch(/<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<a\b/);
		expect(html).toMatch(
			/<h3><a class="resource-inspection-link"[^>]*>grafana<\/a><\/h3><span class="eyebrow">web<\/span>/,
		);
	},
);

test("cards retain non-web and observed-only resources with explicit unavailable details", () => {
	const html = renderResources([
		{
			resourceId: "db",
			type: "postgres",
			sync: "OutOfSync",
			health: "Progressing",
			config: { image: "postgres:17" },
			containers: [],
		},
		{ resourceId: "old", type: "unknown", sync: "OutOfSync", health: "Degraded", containers: [] },
		{
			resourceId: "app",
			type: "web",
			sync: "OutOfSync",
			health: "Missing",
			url: "https://app.metrics.example.test",
			containers: [],
		},
	]);
	expect(html).toContain('href="#/services/metrics/resources/db"');
	expect(html).toContain('href="#/services/metrics/resources/old"');
	expect(html).toContain('href="https://app.metrics.example.test" target="_blank" rel="noreferrer"');
	expect(html).toContain("postgres:17");
	expect(html).toContain("Image unavailable");
	expect(html).toContain("Ingress access unavailable");
	expect(html).toContain("badge-progressing");
	expect(html).toContain("badge-degraded");
	expect(html).toContain("badge-missing");
	expect(html).not.toContain("Private ingress");
	expect(html).not.toContain("Public ingress");
});
