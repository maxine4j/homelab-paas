import type { UiResource } from "@homelab-paas/shared-contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ServicePage } from "../pages/service-page.tsx";

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
