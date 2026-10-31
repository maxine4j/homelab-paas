import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

import { App, AppView, viewPaths } from "./app.tsx";

test.each(["events", "secrets"] as const)("%s retains both revision panels from optional service context", (page) => {
	const html = renderToStaticMarkup(
		<AppView
			route={{ page, serviceId: "demo" }}
			snapshot={{ refresh: () => {} }}
			serviceSnapshot={{
				data: {
					serviceId: "demo",
					phase: "ready",
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
	expect(html).toContain("Active revision");
	expect(html).toContain("Desired revision");
	expect(html).toContain("Active commit");
	expect(html).toContain('title="desired456"');
});

test("Secrets loads independently of unavailable Git/Docker snapshots and retains service tabs", () => {
	expect(viewPaths({ page: "secrets", serviceId: "demo" })).toEqual({});
	const html = renderToStaticMarkup(
		<AppView
			route={{ page: "secrets", serviceId: "demo" }}
			snapshot={{ error: "Docker unavailable", refresh: () => {} }}
			events={{ refresh: () => {} }}
			logs={{}}
		/>,
	);
	expect(html).toContain("Service secrets");
	expect(html).toContain("/etc/homelab-paas/env/demo.env");
	expect(html).toContain('href="#/services/demo/secrets" aria-current="page"');
	expect(html).not.toContain("Docker unavailable");
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
	expect(html).toMatch(
		/breadcrumbs[^]*href="#\/services\/demo\/resources\/app">app<\/a>[^]*aria-current="page">Events/,
	);
	expect(html).toContain("Live · connected");
	expect(html).toContain('aria-label="Resource inspection"');
	expect(html).toContain('href="#/services/demo/resources/app/config">Overview</a>');
	expect(html).toContain('href="#/services/demo/resources/app/logs">Logs</a>');
	expect(html).toContain('href="#/services/demo/resources/app/events" aria-current="page">Events</a>');
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
	expect(html).toMatch(/<nav class="breadcrumbs"[^>]*>[^]*<a href="#\/services\/demo">demo<\/a>/);
	expect(html.match(/<nav class="breadcrumbs"[^>]*>.*?<\/nav>/)?.[0]).not.toContain("<h1>");
	expect(html).toContain('aria-label="Service detail"');
	expect(html).toContain('href="#/services/demo">Overview</a>');
	expect(html).toContain('href="#/services/demo/resources">Resources</a>');
	expect(html).toContain('href="#/services/demo/events" aria-current="page">Events</a>');
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
					phase: "ready",
					source: {},
					descriptorStatus: "available",
					resources: [
						{
							resourceId: "worker",
							type: "worker",
							health: "healthy",
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
	expect(html).toMatch(/service-identity"><h1>demo<\/h1><span class="badge badge-healthy"/);
	expect(html.match(/<h1>/g)).toHaveLength(1);
	expect(html).toContain('href="#/services/demo/resources" aria-current="page">Resources</a>');
	expect(html).not.toContain("Recent events");
});

test("topbar offers Git refresh beside breadcrumbs without a snapshot refresh button", () => {
	const html = renderToStaticMarkup(<App />);
	expect(html).toMatch(
		/<header class="topbar"><nav class="breadcrumbs".*?<\/nav><div class="git-refresh"><div class="service-actions"><button class="action-info" type="button">Refresh all<\/button><\/div><\/div><\/header>/,
	);
	expect(html).not.toContain("Refresh snapshot");
	expect(html.match(/Refresh all/g)).toHaveLength(1);
	expect(html).not.toMatch(/<main[^>]*>.*Refresh all/);
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
	expect(html).toContain('href="#/services" aria-current="page">Services</a>');
	expect(html).toContain('href="#/cluster">Cluster config</a>');
	expect(html).not.toContain("<aside");
});
