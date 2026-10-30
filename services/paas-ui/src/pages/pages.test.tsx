import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ServiceEvents } from "../components/service-events.tsx";
import { StatusBadge } from "../components/status-badge.tsx";
import { parseRoute } from "../hooks/use-route.ts";
import { ClusterPage } from "./cluster-page.tsx";
import { ResourcePage } from "./resource-page.tsx";
import { ServiceEventsPage } from "./service-events-page.tsx";
import { ServicePage } from "./service-page.tsx";
import { ServicesPage } from "./services-page.tsx";

test.each(["deploying", "missing", "healthy", "unhealthy"] as const)(
	"resource %s health sits beside its heading and replaces card container status",
	(health) => {
		const resource = {
			resourceId: "app",
			type: "web",
			health,
			containers: [
				{ id: "c", resourceId: "app", imageId: "image", revision: "rev", state: "running", running: true },
			],
		};
		const html = renderToStaticMarkup(<ResourcePage serviceId='demo' resource={resource} tab='config' />);
		expect(html).toMatch(new RegExp(`class="service-identity"><h1>app</h1>[^]*?badge-${health}`));
		expect(html).toContain("badge-running");
		expect(html).toContain("running");
		const cards = renderToStaticMarkup(
			<ServicePage
				service={{
					serviceId: "demo",
					phase: "ready",
					source: {},
					descriptorStatus: "available",
					resources: [resource],
				}}
			/>,
		);
		expect(cards).toMatch(new RegExp(`card resource-link[^]*?badge-${health}`));
		expect(cards).not.toContain("badge-running");
	},
);

test("web inspection links to the resource host and primary service alias", () => {
	const html = renderToStaticMarkup(
		<ResourcePage
			serviceId='demo'
			tab='config'
			resource={{
				resourceId: "app",
				health: "missing",
				type: "web",
				containers: [],
				url: "https://app.demo.example.test",
				primaryUrl: "https://demo.example.test",
			}}
		/>,
	);
	expect(html).toContain('href="https://app.demo.example.test"');
	expect(html).toContain('href="https://demo.example.test"');
});

test("cluster and service pages expose configuration, deployment status and resource navigation", () => {
	expect(
		renderToStaticMarkup(
			<ClusterPage cluster={{ clusterId: "local", config: { version: 1 }, revision: "r1", fields: [] }} />,
		),
	).toContain("Cluster configuration");
	const services = renderToStaticMarkup(<ServicesPage services={[{ serviceId: "demo", phase: "failed" }]} />);
	expect(services).toContain("#/services/demo");
	expect(services).toContain("unhealthy");
	expect(renderToStaticMarkup(<ServicesPage services={[]} />)).toContain("No services configured");
	const detail = renderToStaticMarkup(
		<ServicePage
			service={{
				serviceId: "demo",
				phase: "ready",
				source: {},
				descriptorStatus: "unavailable",
				resources: [{ resourceId: "app", type: "web", health: "missing", containers: [] }],
			}}
		/>,
	);
	expect(detail).toContain("#/services/demo/resources/app");
	expect(detail).toContain("Descriptor unavailable");
	expect(detail).toContain("badge-missing");
	expect(detail).not.toContain("No containers");
});

test.each([
	["ready", "healthy"],
	["deploying", "deploying"],
	["failed", "unhealthy"],
	["unknown", "missing"],
])("service phase %s displays %s", (phase, label) => {
	const html = renderToStaticMarkup(<StatusBadge status={phase!} />);
	expect(html).toContain(`badge-${label}`);
	expect(html).toContain(` ${label}`);
});

test("service cards provide a full-card detail link, an independent web link, description and compact revision rows", () => {
	const html = renderToStaticMarkup(
		<ServicesPage
			services={[
				{
					serviceId: "demo",
					phase: "ready",
					activeRevision: "active123",
					desiredRevision: "desired456",
					description: "Document <archive>",
					primaryUrl: "https://demo.example.com",
					activeRevisionMetadata: {
						message: "Deploy <web>\n\nFull details",
						authorName: "Alex",
						authoredAt: "2026-10-26T00:00:00Z",
					},
				},
			]}
		/>,
	);
	expect(html).toMatch(/service-card-heading[^]*<h2>[^]*demo[^]*<\/h2>[^]*primary-web-link[^]*badge-healthy/);
	expect(html).toContain('class="service-card-link" href="#/services/demo"');
	expect(html).toMatch(/href="https:\/\/demo.example.com" target="_blank" rel="noreferrer"/);
	expect(html).toContain('class="service-description" title="Document &lt;archive&gt;">Document &lt;archive&gt;</p>');
	expect(html).toMatch(/service-description[^]*Document &lt;archive&gt;[^]*<dt>Revision<\/dt>[^]*active123/);
	expect(html).toContain('class="revision-summary"');
	expect(html).toContain('title="Deploy &lt;web&gt;\n\nFull details"');
	expect(html).toContain("Alex");
	expect(html).toContain('dateTime="2026-10-26T00:00:00Z"');
	expect(html).not.toContain("desired456");
	expect(html).not.toContain("Desired revision");
	expect(html).not.toMatch(/<a\s[^>]*>(?:(?!<\/a>)[^])*<a\s/);
	expect(html).not.toContain("View resources");
	expect(html).not.toContain('eyebrow">Service</span>');
});

test("service revisions link their own GitHub commits beside the identity and retain commit metadata", () => {
	const service = {
		serviceId: "demo",
		phase: "ready" as const,
		source: { remote: "https://github.com/owner/repo.git" },
		descriptorStatus: "available" as const,
		resources: [],
		activeRevision: "active123",
		descriptorRevision: "descriptor456",
		activeRevisionMetadata: {
			authorName: "Alex <admin>",
			authoredAt: "2026-10-26T00:00:00Z",
			message: "Deploy <script>\n\nDetails",
		},
		descriptorRevisionMetadata: {
			authorName: "Sam",
			authoredAt: "2026-10-25T00:00:00Z",
			message: "Update descriptor",
		},
	};
	const html = renderToStaticMarkup(<ServicePage service={service} />);
	expect(html).toMatch(
		/service-heading-row[^]*<h1>demo<\/h1>[^]*Active revision[^]*>active1<\/a>[^]*Desired revision[^]*>descrip<\/a>/,
	);
	expect(html).toContain('title="active123"');
	expect(html).toContain('title="descriptor456"');
	expect(html).toContain('href="https://github.com/owner/repo/commit/active123"');
	expect(html).toContain('href="https://github.com/owner/repo/commit/descriptor456"');
	expect(html).toContain("Update descriptor");
	expect(html).toContain("Deploy &lt;script&gt;");
	expect(html).toContain("Alex &lt;admin&gt;");
	expect(html).toContain("Sam");
	expect(html).toContain('dateTime="2026-10-26T00:00:00Z"');
	expect(html).not.toContain('<dl class="summary">');
	expect(html).not.toContain("Desired resources alongside observed containers.");
	expect(renderToStaticMarkup(<ServicesPage services={[service]} />)).not.toContain("Update descriptor");
});

test("service revision hashes stay visible when metadata is unavailable", () => {
	const html = renderToStaticMarkup(
		<ServicePage
			service={{
				serviceId: "demo",
				phase: "ready",
				source: {},
				descriptorStatus: "available",
				resources: [],
				activeRevision: "active123",
				descriptorRevision: "descriptor456",
			}}
		/>,
	);
	expect(html).toContain("active123");
	expect(html).toContain("descriptor456");
	expect(html).toContain(">active1</span>");
	expect(html).toContain(">descrip</span>");
	expect(html.match(/Commit details unavailable/g)).toHaveLength(2);
});

test("service cards show commit details only for the active revision", () => {
	const metadata = {
		message: "Deploy <web>\n\nFull details",
		authorName: "Alex",
		authoredAt: "2026-10-26T00:00:00Z",
	};
	const html = renderToStaticMarkup(
		<ServicesPage
			services={[
				{
					serviceId: "demo",
					phase: "ready",
					activeRevision: "active",
					desiredRevision: "desired",
					activeRevisionMetadata: metadata,
					desiredRevisionMetadata: { ...metadata, message: "Next deployment", authorName: "Sam" },
				},
			]}
		/>,
	);
	expect(html).toContain("Deploy &lt;web&gt;\n\nFull details");
	expect(html).toContain("Alex");
	expect(html).not.toContain("Next deployment");
	expect(html).not.toContain("Sam");
	expect(html.match(/dateTime="2026-10-26T00:00:00Z"/g)).toHaveLength(1);
	const unavailable = renderToStaticMarkup(
		<ServicesPage
			services={[{ serviceId: "demo", phase: "ready", activeRevision: "active", desiredRevision: "desired" }]}
		/>,
	);
	expect(unavailable.match(/Commit details unavailable/g)).toHaveLength(1);
	const missing = renderToStaticMarkup(<ServicesPage services={[{ serviceId: "demo", phase: "unknown" }]} />);
	expect(missing).toContain("Not deployed");
	expect(missing).not.toContain('target="_blank"');
});

const events = [
	{
		timestamp: 1000,
		level: "error" as const,
		event: "reconciliation.failed" as const,
		message: "Cannot resolve application secrets <unsafe>",
		resourceId: "app",
		failures: 9,
		retryAt: 2000,
		revision: "abcdef",
	},
];

test("service details show recent failure events and link to service event history", () => {
	const html = renderToStaticMarkup(
		<ServicePage
			service={{ serviceId: "demo", phase: "failed", source: {}, descriptorStatus: "unavailable", resources: [] }}
			events={events}
		/>,
	);
	expect(html).toContain("Cannot resolve application secrets &lt;unsafe&gt;");
	expect(html).toContain("Recent events");
});

test("service details show two recent events above resources and collapse the complete descriptor", () => {
	const html = renderToStaticMarkup(
		<ServicePage
			service={{
				serviceId: "demo",
				phase: "ready",
				source: { remote: "https://github.com/example/demo.git", descriptorPath: "service.sd.yaml" },
				descriptorStatus: "available",
				descriptorRevision: "abc1234",
				descriptorYaml:
					"version: 1\nmetadata:\n  serviceId: demo\nresources:\n  app:\n    type: web\n    image: app:1\n",
				descriptor: {
					version: 1,
					metadata: { serviceId: "demo" },
					resources: { app: { type: "web", image: "app:1" } },
				},
				resources: [
					{
						resourceId: "app",
						type: "web",
						health: "missing",
						primaryUrl: "https://demo.example.test",
						containers: [],
					},
				],
			}}
			events={[
				...events,
				{ ...events[0]!, timestamp: 500, message: "Earlier event" },
				{ ...events[0]!, timestamp: 100, message: "Oldest event" },
			]}
		/>,
	);
	expect(html.indexOf("Recent events")).toBeLessThan(html.indexOf("Resources"));
	expect(html.indexOf("Resources")).toBeLessThan(html.indexOf("Service descriptor"));
	expect(html).toContain("1 more events...");
	expect(html).toContain("Earlier event");
	expect(html).not.toContain("Oldest event");
	expect(html).not.toContain("Inspect resource");
	expect(html).toContain('<details class="json-disclosure"><summary>Service descriptor YAML</summary>');
	expect(html).toContain('aria-label="Service descriptor YAML"');
	expect(html).toContain("version: 1\nmetadata:\n  serviceId: demo");
	expect(html).toMatch(/service-heading-row[^]*<h1>demo<\/h1>[^]*badge-healthy[^]*primary-web-link/);
	expect(html).toContain('href="https://github.com/example/demo/blob/abc1234/service.sd.yaml"');
	expect(html).toContain('href="https://demo.example.test" target="_blank" rel="noreferrer"');
	expect(html).toMatch(/primary-web-link[^>]*>demo.example.test[^<]*<span aria-hidden="true">↗<\/span><\/a>/);
	expect(html).toContain("app:1");
	expect(html).not.toContain("&quot;metadata&quot;");
	expect(html).not.toContain("Service source configuration");
});

test("event history direct links resolve and render timestamp, resource, severity and retry details", () => {
	expect(parseRoute("#/services/demo/events")).toEqual({ page: "events", serviceId: "demo" });
	expect(parseRoute("#/services/demo/events/extra")).toEqual({ page: "missing" });
	const html = renderToStaticMarkup(<ServiceEventsPage serviceId='demo' events={events} />);
	expect(html).toContain('href="#/services/demo"');
	expect(html).toContain("reconciliation.failed");
	expect(html).toContain("error");
	expect(html).toContain("app");
	expect(html).toContain("abcdef");
	expect(html).toContain("Attempt 9");
	expect(html).toContain("Next retry");
	expect(html).toContain('dateTime="1970-01-01T00:00:01.000Z"');
	expect(html).toContain("&lt;unsafe&gt;");
});

test("event views distinguish loading, unavailable and empty histories", () => {
	expect(renderToStaticMarkup(<ServiceEvents />)).toContain("Loading events");
	expect(renderToStaticMarkup(<ServiceEvents events={[]} />)).toContain("No events recorded");
	expect(renderToStaticMarkup(<ServiceEvents error='History unavailable' />)).toContain('role="alert"');
	expect(renderToStaticMarkup(<ServiceEvents error='History unavailable' />)).toContain("History unavailable");
});

test("events expose selectable error diagnostics in an escaped disclosure", () => {
	const html = renderToStaticMarkup(
		<ServiceEvents events={[{ ...events[0]!, diagnostics: "Error: <bind failed>\n at start" }]} />,
	);
	expect(html).toContain("<details");
	expect(html).toContain("Error diagnostics");
	expect(html).toContain("&lt;bind failed&gt;");
	expect(html).toContain(" at start");
});

test("both service event views show missing names, host edit path and safe syntax location", () => {
	const detailed = [
		{
			...events[0]!,
			secretFailure: {
				reason: "missing-variables" as const,
				filePath: "/etc/homelab-paas/env/demo.env",
				hostFilePath: "/srv/config/env/demo.env",
				missingVariables: ["TOKEN", "PASSWORD"],
			},
		},
	];
	const full = renderToStaticMarkup(<ServiceEventsPage serviceId='demo' events={detailed} />);
	const recent = renderToStaticMarkup(
		<ServicePage
			service={{ serviceId: "demo", phase: "failed", source: {}, descriptorStatus: "available", resources: [] }}
			events={detailed}
		/>,
	);
	for (const html of [full, recent]) {
		expect(html).toContain("Missing variables");
		expect(html).toContain("TOKEN, PASSWORD");
		expect(html).toContain("Edit on Docker host");
		expect(html).toContain("/srv/config/env/demo.env");
		expect(html).toContain("/etc/homelab-paas/env/demo.env");
	}
	const syntax = renderToStaticMarkup(
		<ServiceEvents
			events={[{ ...events[0]!, secretFailure: { reason: "invalid-file", filePath: "/env/demo.env", line: 3 } }]}
		/>,
	);
	expect(syntax).toContain("Invalid secret file format");
	expect(syntax).toContain("Line 3");
	expect(syntax).toContain("Host path unavailable");
	expect(syntax).not.toContain("Edit on Docker host");
});

test("cluster presents identity and ingress above an editor limited to Git, reconciliation and services", () => {
	const html = renderToStaticMarkup(
		<ClusterPage
			cluster={{
				clusterId: "local",
				config: {},
				revision: "r1",
				fields: [
					...Object.entries({
						version: 1,
						"metadata.clusterId": "local",
						"ingress.httpPort": 8080,
						"ingress.httpsPort": 8443,
						"session.maxAgeSeconds": 3600,
						"git.pollIntervalSeconds": 5,
						"reconciliation.retryBackoffSeconds": 10,
					}).map(([path, value]) => ({
						path,
						value,
						kind: "text" as const,
						readOnly: false,
						managedByEnvironment: false,
					})),
					{ path: "services", kind: "json", value: {}, readOnly: false, managedByEnvironment: false },
					{
						path: "auth.github.clientSecret",
						kind: "secret",
						configured: true,
						readOnly: false,
						managedByEnvironment: false,
					},
					{
						path: "tls.acme.email",
						kind: "text",
						value: "managed@example.test",
						readOnly: true,
						managedByEnvironment: true,
					},
					{
						path: "ingress.baseDomain",
						kind: "text",
						value: "example.test",
						readOnly: true,
						managedByEnvironment: false,
					},
				],
			}}
		/>,
	);
	const summary = html.slice(html.indexOf('aria-label="Cluster details"'), html.indexOf("<form"));
	for (const value of [
		"Cluster ID",
		"local",
		"Base domain",
		"example.test",
		"HTTP port",
		"8080",
		"HTTPS port",
		"8443",
	])
		expect(summary).toContain(value);
	expect(summary).not.toContain("<input");
	for (const path of [
		"version",
		"metadata.clusterId",
		"ingress.baseDomain",
		"ingress.httpPort",
		"ingress.httpsPort",
		"auth.github.clientSecret",
		"session.maxAgeSeconds",
		"tls.acme.email",
	])
		expect(html).not.toContain(`id="config-${path}"`);
	expect(html).toContain('id="config-git.pollIntervalSeconds"');
	expect(html).toContain('id="config-reconciliation.retryBackoffSeconds"');
	expect(html).toContain("Add service");
	expect(html).toContain("Save configuration");
});

test("resource inspection renders configuration, state and escaped log output", () => {
	const resource = {
		health: "healthy" as const,
		resourceId: "app",
		type: "web",
		config: { image: "app:1" },
		configYaml: "image: app:1\n",
		containers: [{ id: "c", resourceId: "app", state: "running", imageId: "sha256:a", revision: "rev" }],
	};
	for (const tab of ["config", "logs"] as const) {
		const html = renderToStaticMarkup(
			<ResourcePage
				serviceId='demo'
				resource={resource}
				tab={tab}
				containerId='c'
				logs={{ containerId: "c", content: "<script>hello</script>", tail: 200 }}
			/>,
		);
		expect(html).toContain('aria-current="page"');
		if (tab === "config") {
			expect(html).toContain("image: app:1\n");
			expect(html).not.toContain("Descriptor unavailable.");
			expect(html).toContain("<h2>Configuration</h2>");
			expect(html).toContain("<h2>Live state</h2>");
			expect(html.indexOf("<h2>Configuration</h2>")).toBeLessThan(html.indexOf("<h2>Live state</h2>"));
			expect(html).toContain("running");
			expect(html).not.toContain('href="#/services/demo/resources/app/state"');
		}
		if (tab === "logs") {
			expect(html).toContain("&lt;script&gt;");
			expect(html).not.toContain("<script>");
		}
	}
});

test("logs open without a container dropdown for default and explicit container links", () => {
	const resource = {
		health: "healthy" as const,
		resourceId: "app",
		type: "web",
		containers: ["first", "second"].map((id) => ({
			id,
			resourceId: "app",
			imageId: "sha256:a",
			state: "running",
			revision: "rev",
		})),
	};
	const initial = renderToStaticMarkup(<ResourcePage serviceId='demo' resource={resource} tab='logs' />);
	expect(initial).not.toContain("<select");
	expect(initial).toContain("Last 200 stdout / stderr lines");
	expect(initial).toContain("Loading logs");
	const explicit = renderToStaticMarkup(
		<ResourcePage serviceId='demo' resource={resource} tab='logs' containerId='second' />,
	);
	expect(explicit).not.toContain("<select");
	expect(explicit).toContain("Loading logs");
	const empty = renderToStaticMarkup(
		<ResourcePage serviceId='demo' resource={{ ...resource, containers: [] }} tab='logs' />,
	);
	expect(empty).toContain("No containers available for logs");
});

test("routes distinguish service/resource inspection and reject unsupported navigation", () => {
	expect(parseRoute("#/services/demo/resources/app/state")).toEqual({
		page: "resource",
		serviceId: "demo",
		resourceId: "app",
		tab: "config",
	});
	expect(parseRoute("#/services/demo/resources/app/logs/c")).toEqual({
		page: "resource",
		serviceId: "demo",
		resourceId: "app",
		tab: "logs",
		containerId: "c",
	});
	expect(parseRoute("#/services/demo")).toEqual({ page: "service", serviceId: "demo" });
	expect(parseRoute("#/cluster")).toEqual({ page: "cluster" });
	expect(parseRoute("#/unknown")).toEqual({ page: "missing" });
});
