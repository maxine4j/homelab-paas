import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ResourcePage } from "../pages/resource-page.tsx";
import { ServicePage } from "../pages/service-page.tsx";
import { ServicesPage } from "../pages/services-page.tsx";
import { StatusBadge } from "./status-badge.tsx";

test.each(["Healthy", "Progressing", "Degraded", "Missing", "Unknown"] as const)(
	"health badge identifies %s accessibly",
	(status) => {
		const html = renderToStaticMarkup(<StatusBadge kind='Health' status={status} />);
		expect(html).toContain(`aria-label="Health: ${status}"`);
		expect(html).toContain(`badge-${status.toLowerCase()}`);
	},
);

test.each(["Synced", "OutOfSync", "Unknown"] as const)("sync badge identifies %s accessibly", (status) => {
	const html = renderToStaticMarkup(<StatusBadge kind='Sync' status={status} />);
	expect(html).toContain(`aria-label="Sync: ${status}"`);
	expect(html).toContain(`badge-${status.toLowerCase()}`);
});

test("service and resource surfaces present independent status pairs", () => {
	const resource = {
		resourceId: "app",
		type: "web",
		sync: "Synced" as const,
		health: "Degraded" as const,
		containers: [],
	};
	const service = {
		serviceId: "demo",
		sync: "OutOfSync" as const,
		health: "Healthy" as const,
		source: {},
		descriptorStatus: "available" as const,
		resources: [resource],
	};
	for (const html of [
		renderToStaticMarkup(<ServicesPage services={[service]} />),
		renderToStaticMarkup(<ServicePage service={service} />),
	]) {
		expect(html).toContain('aria-label="Health: Healthy"');
		expect(html).toContain('aria-label="Sync: OutOfSync"');
	}
	for (const html of [
		renderToStaticMarkup(<ServicePage service={service} />),
		renderToStaticMarkup(<ServicePage service={service} tab='resources' />),
		renderToStaticMarkup(<ResourcePage serviceId='demo' resource={resource} tab='config' />),
	]) {
		expect(html).toContain('aria-label="Health: Degraded"');
		expect(html).toContain('aria-label="Sync: Synced"');
	}
});
