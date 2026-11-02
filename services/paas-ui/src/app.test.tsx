import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

import { App, AppView, viewPaths } from "./app.tsx";

test("paused service snapshots offer Resume beside Refresh and Redeploy", () => {
	const html = renderToStaticMarkup(
		<AppView
			route={{ page: "service", serviceId: "demo" }}
			snapshot={{
				refresh: () => {},
				data: {
					serviceId: "demo",
					source: {},
					descriptorStatus: "available",
					resources: [],
					health: "Paused",
					sync: "OutOfSync",
				},
			}}
			events={{ refresh: () => {} }}
			logs={{}}
		/>,
	);
	expect(html).toContain("Resume</button>");
	expect(html).toContain('aria-label="Health: Paused"');
	expect(html).toContain('aria-label="Sync: OutOfSync"');
});

test.each([
	{ page: "service", serviceId: "demo", tab: "overview" },
	{ page: "service", serviceId: "demo", tab: "resources" },
	{ page: "service", serviceId: "demo", tab: "descriptor" },
	{ page: "events", serviceId: "demo" },
	{ page: "secrets", serviceId: "demo" },
	{ page: "resource", serviceId: "demo", resourceId: "app", tab: "config" },
	{ page: "resource", serviceId: "demo", resourceId: "app", tab: "logs" },
	{ page: "resource-events", serviceId: "demo", resourceId: "app" },
	{ page: "cluster", tab: "config" },
	{ page: "cluster", tab: "logs" },
	{ page: "cluster", tab: "ingress-logs" },
] as const)("$page $tab breadcrumbs show entity ancestry without tab names", (route) => {
	const html = renderToStaticMarkup(
		<AppView route={route} snapshot={{ refresh: () => {} }} events={{ refresh: () => {} }} logs={{}} />,
	);
	const breadcrumb = html.match(/<nav class="breadcrumbs"[^>]*>.*?<\/nav>/)?.[0] ?? "";
	expect(breadcrumb).not.toMatch(/Overview|Resources|Descriptor|Events|Secrets|Logs|logs/);
	if (route.page === "cluster") expect(breadcrumb).toContain('aria-current="page">Cluster');
	else {
		expect(breadcrumb).toContain('href="#/services"');
		expect(breadcrumb).toContain('href="#/services/demo"');
		expect(breadcrumb).toContain(`aria-current="page">${"resourceId" in route ? "app" : "demo"}</a>`);
	}
});

test("brand link displays the pasta emoji used by the favicon", () => {
	const html = renderToStaticMarkup(
		<AppView
			route={{ page: "services" }}
			snapshot={{ refresh: () => {} }}
			events={{ refresh: () => {} }}
			logs={{}}
		/>,
	);
	const brand = html.match(/<a class="brand"[^]*?<\/a>/)?.[0] ?? "";

	expect(brand).toContain('href="#/services"');
	expect(brand).toContain('<span class="brand-icon" aria-hidden="true">🍝</span>');
	expect(brand).toContain("homelab");
});

test("main navigation retains readable destinations with decorative icons", () => {
	const html = renderToStaticMarkup(
		<AppView
			route={{ page: "services" }}
			snapshot={{ refresh: () => {} }}
			events={{ refresh: () => {} }}
			logs={{}}
		/>,
	);
	const nav = html.match(/<nav aria-label="Main navigation"[^]*?<\/nav>/)?.[0] ?? "";
	expect(nav.match(/<svg\b[^>]*aria-hidden="true"/g)).toHaveLength(2);
	expect(nav).toMatch(/href="#\/services" aria-current="page"[^]*?<\/svg>Services<\/a>/);
	expect(nav).toMatch(/href="#\/cluster"[^]*?<\/svg>Cluster<\/a>/);
});

test.each(["logs", "ingress-logs"] as const)("Cluster %s remains usable when configuration is unavailable", (tab) => {
	const html = renderToStaticMarkup(
		<AppView
			route={{ page: "cluster", tab }}
			snapshot={{ error: "Config unavailable", refresh: () => {} }}
			events={{ refresh: () => {} }}
			logs={{ data: { containerId: "controller", content: "ready", tail: 200 } }}
		/>,
	);
	expect(html).toMatch(/href="#\/cluster" aria-current="page"><svg\b[^]*?<\/svg>Cluster<\/a>/);
	expect(html).toContain(tab === "logs" ? "PaaS logs" : "Ingress logs");
	expect(html).toContain("ready");
	expect(html).not.toContain("Cluster config");
});

test("all service tabs share the same complete header with actions beside identity and ingress below", () => {
	const service = {
		serviceId: "demo",
		sync: "Synced" as const,
		health: "Healthy" as const,
		source: {},
		descriptorStatus: "available" as const,
		activeRevision: "active123",
		descriptorRevision: "desired456",
		descriptorYaml: "version: 1",
		resources: [
			{
				resourceId: "web",
				type: "web",
				sync: "Synced" as const,
				health: "Healthy" as const,
				primaryUrl: "https://demo.example.test",
				containers: [],
			},
		],
	};
	const routes = [
		{ page: "service", serviceId: "demo", tab: "overview" },
		{ page: "service", serviceId: "demo", tab: "resources" },
		{ page: "service", serviceId: "demo", tab: "descriptor" },
		{ page: "events", serviceId: "demo" },
		{ page: "secrets", serviceId: "demo" },
	] as const;
	const headers = routes.map((route) => {
		const html = renderToStaticMarkup(
			<AppView
				route={route}
				snapshot={{ data: service, refresh: () => {} }}
				events={{ data: [], refresh: () => {} }}
				logs={{}}
			/>,
		);
		const header = html.match(/<div class="page-heading service-heading">.*?(?=<nav class="tabs")/)?.[0];
		expect(header).toMatch(
			/service-identity[^]*<h1>demo<\/h1>[^]*badge-healthy[^]*git-refresh[^]*Refresh<\/button>[^]*Redeploy<\/button>/,
		);
		expect(header).not.toContain("Active revision");
		expect(header).not.toContain("Desired revision");
		if (route.page === "service" && route.tab === "overview") {
			expect(html).toContain("Active revision");
			expect(html).toContain("Desired revision");
		} else {
			expect(html).not.toContain("Active revision");
			expect(html).not.toContain("Desired revision");
		}
		expect(header).toContain('href="https://demo.example.test"');
		expect(html.match(/<header class="topbar">.*?<\/header>/)?.[0]).not.toContain("git-refresh");
		return header;
	});
	expect(new Set(headers).size).toBe(1);
});

test.each(["events", "secrets"] as const)("%s reuses the service snapshot subscription without revisions", (page) => {
	expect(viewPaths({ page, serviceId: "demo" }).snapshot).toBe(
		viewPaths({ page: "service", serviceId: "demo" }).snapshot,
	);
	const html = renderToStaticMarkup(
		<AppView
			route={{ page, serviceId: "demo" }}
			snapshot={{
				refresh: () => {},
				data: {
					serviceId: "demo",
					sync: "Synced",
					health: "Healthy",
					source: {},
					descriptorStatus: "available",
					resources: [],
					activeRevision: "active123",
					descriptorRevision: "desired456",
					activeRevisionMetadata: {
						message: "Active commit",
						authorName: "Alex",
						authoredAt: "2026-10-31T00:00:00Z",
					},
				},
			}}
			events={{ data: [], refresh: () => {} }}
			logs={{}}
		/>,
	);
	expect(html).not.toContain("Active revision");
	expect(html).not.toContain("Desired revision");
	expect(html).not.toContain("Active commit");
	expect(html).not.toContain('title="desired456"');
});

test("Secrets loads independently of unavailable Git/Docker snapshots and retains service tabs", () => {
	expect(viewPaths({ page: "secrets", serviceId: "demo" })).toEqual({ snapshot: "/services/demo" });
	const html = renderToStaticMarkup(
		<AppView
			route={{ page: "secrets", serviceId: "demo" }}
			snapshot={{ error: "Docker unavailable", refresh: () => {} }}
			events={{ refresh: () => {} }}
			logs={{}}
		/>,
	);
	expect(html).toContain("Service secrets");
	expect(html).not.toContain("/etc/homelab-paas/env/demo.env");
	expect(html).toContain('href="#/services/demo/secrets" aria-current="page"');
	expect(html).not.toContain("Docker unavailable");
});

test("Secrets reports the service subscription connection in the footer", () => {
	const html = renderToStaticMarkup(
		<AppView
			route={{ page: "secrets", serviceId: "demo" }}
			snapshot={{ connected: true, refresh: () => {} }}
			events={{ refresh: () => {} }}
			logs={{}}
		/>,
	);
	expect(html).toContain("Live · connected");
});

test.each([
	{ page: "service", serviceId: "demo", tab: "overview" },
	{ page: "service", serviceId: "demo", tab: "resources" },
	{ page: "service", serviceId: "demo", tab: "descriptor" },
	{ page: "events", serviceId: "demo" },
	{ page: "secrets", serviceId: "demo" },
] as const)("$page $tab retains shared navigation without revisions during loading and service errors", (route) => {
	for (const error of [undefined, "Cluster data is unavailable; retry shortly"]) {
		const html = renderToStaticMarkup(
			<AppView
				route={route}
				snapshot={{ error, refresh: () => {} }}
				events={{ data: [], refresh: () => {} }}
				logs={{}}
			/>,
		);
		expect(html).not.toContain("Active revision");
		expect(html).not.toContain("Desired revision");
		expect(html).toContain('aria-label="Service detail"');
	}
});

test("resource overview and history share the service events stream while history avoids inspection", () => {
	expect(viewPaths({ page: "resource", serviceId: "demo", resourceId: "app", tab: "config" })).toEqual({
		snapshot: "/services/demo/resources/app",
		events: "/services/demo/events",
	});
	expect(viewPaths({ page: "resource-events", serviceId: "demo", resourceId: "app" })).toEqual({
		events: "/services/demo/events",
	});
});

test("resource event history renders independently of failed inspection with linked breadcrumbs", () => {
	const html = renderToStaticMarkup(
		<AppView
			route={{ page: "resource-events", serviceId: "demo", resourceId: "app" }}
			snapshot={{ error: "Docker unavailable", refresh: () => {} }}
			events={{
				data: [
					{
						timestamp: 1,
						event: "reconciliation.failed",
						level: "error",
						message: "App failed",
						resourceId: "app",
					},
				],
				connected: true,
				refresh: () => {},
			}}
			logs={{}}
		/>,
	);
	expect(html).toContain("App failed");
	expect(html).not.toContain("Docker unavailable");
	expect(html).toMatch(/breadcrumbs[^]*href="#\/services\/demo\/resources\/app" aria-current="page">app<\/a>/);
	expect(html).toContain("Live · connected");
	expect(html).toContain('aria-label="Resource inspection"');
	expect(html).toMatch(/href="#\/services\/demo\/resources\/app\/config"><svg\b[^]*?<\/svg>Overview<\/a>/);
	expect(html).toMatch(/href="#\/services\/demo\/resources\/app\/logs"><svg\b[^]*?<\/svg>Logs<\/a>/);
	expect(html).toMatch(
		/href="#\/services\/demo\/resources\/app\/events" aria-current="page"><svg\b[^]*?<\/svg>Events<\/a>/,
	);
	expect(html).not.toContain('class="back-link"');
});

test("service history retains service navigation without a Git snapshot", () => {
	const html = renderToStaticMarkup(
		<AppView
			route={{ page: "events", serviceId: "demo" }}
			snapshot={{ error: "Git unavailable", refresh: () => {} }}
			events={{ data: [], refresh: () => {} }}
			logs={{}}
		/>,
	);
	expect(html).toContain("<h1>demo</h1>");
	expect(html).toMatch(/<nav class="breadcrumbs"[^>]*>[^]*<a href="#\/services\/demo" aria-current="page">demo<\/a>/);
	expect(html.match(/<nav class="breadcrumbs"[^>]*>.*?<\/nav>/)?.[0]).not.toContain("<h1>");
	expect(html).toContain('aria-label="Service detail"');
	expect(html).toMatch(/href="#\/services\/demo"><svg\b[^]*?<\/svg>Overview<\/a>/);
	expect(html).toMatch(/href="#\/services\/demo\/resources"><svg\b[^]*?<\/svg>Resources<\/a>/);
	expect(html).toMatch(/href="#\/services\/demo\/events" aria-current="page"><svg\b[^]*?<\/svg>Events<\/a>/);
	expect(html).not.toContain("Git unavailable");
	expect(html).not.toContain('class="back-link"');
});

test.each([
	[{}, "Loading events"],
	[{ data: [] }, "No events recorded"],
	[{ error: "History unavailable" }, "History unavailable"],
])("resource event history retains explicit states and reconnect status", (events, expected) => {
	const html = renderToStaticMarkup(
		<AppView
			route={{ page: "resource-events", serviceId: "demo", resourceId: "app" }}
			snapshot={{ refresh: () => {} }}
			events={{ ...events, refresh: () => {} }}
			logs={{}}
		/>,
	);
	expect(html).toContain(expected);
	expect(html).toContain("Live · reconnecting");
});

afterEach(() => vi.unstubAllEnvs());

test("service Resources uses the service snapshot and renders detailed cards through AppView", () => {
	const route = { page: "service", serviceId: "demo", tab: "resources" } as const;
	expect(viewPaths(route)).toEqual({ snapshot: "/services/demo", events: "/services/demo/events" });
	const html = renderToStaticMarkup(
		<AppView
			route={route}
			snapshot={{
				data: {
					serviceId: "demo",
					sync: "Synced",
					health: "Healthy",
					source: {},
					descriptorStatus: "available",
					resources: [
						{
							resourceId: "worker",
							type: "worker",
							sync: "Synced",
							health: "Healthy",
							config: { image: "worker:2" },
							containers: [],
						},
					],
				},
				refresh: () => {},
			}}
			events={{ data: [], refresh: () => {} }}
			logs={{}}
		/>,
	);
	expect(html).toContain("worker:2");
	expect(html).toMatch(
		/service-identity"><h1>demo<\/h1><span class="status-badges"><span class="badge badge-healthy"/,
	);
	expect(html.match(/<h1>/g)).toHaveLength(1);
	expect(html).toMatch(/href="#\/services\/demo\/resources" aria-current="page"><svg\b[^]*?<\/svg>Resources<\/a>/);
	expect(html).not.toContain("Recent events");
});

test("services heading offers Git refresh below the breadcrumbs", () => {
	const html = renderToStaticMarkup(
		<AppView
			route={{ page: "services" }}
			snapshot={{ data: [], refresh: () => {} }}
			events={{ refresh: () => {} }}
			logs={{}}
		/>,
	);
	expect(html).toMatch(/<main[^>]*><div class="page-heading"[^]*?Refresh all/);
	expect(html).not.toContain("Refresh snapshot");
	expect(html.match(/Refresh all/g)).toHaveLength(1);
	expect(html).not.toMatch(/<header class="topbar">[^]*?Refresh all[^]*?<\/header>/);
});

test("footer identifies the platform build with a short revision and full revision tooltip", () => {
	vi.stubEnv("VITE_BUILD_SHA", "1234567890abcdef1234567890abcdef12345678");
	const html = renderToStaticMarkup(<App />);
	expect(html).toMatch(
		/<footer>.*<span title="1234567890abcdef1234567890abcdef12345678">Build 1234567<\/span>.*<\/footer>/,
	);
});

test("footer explicitly identifies builds without a supplied revision", () => {
	vi.stubEnv("VITE_BUILD_SHA", undefined);
	expect(renderToStaticMarkup(<App />)).toMatch(/<footer>.*Build unknown.*<\/footer>/);
});

test("main navigation is in the page header with services and cluster links", () => {
	const html = renderToStaticMarkup(<App />);
	expect(html).toMatch(/<header class="primary-header">.*<nav aria-label="Main navigation">/);
	expect(html).toMatch(/href="#\/services" aria-current="page"><svg\b[^]*?<\/svg>Services<\/a>/);
	expect(html).toMatch(/href="#\/cluster"><svg\b[^]*?<\/svg>Cluster<\/a>/);
	expect(html).not.toContain("<aside");
});
