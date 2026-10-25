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

test("web inspection links to the resource host and primary service alias", () => {
	const html = renderToStaticMarkup(
		<ResourcePage
			serviceId='demo'
			tab='config'
			resource={{
				resourceId: "app",
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
				resources: [{ resourceId: "app", type: "web", containers: [] }],
			}}
		/>,
	);
	expect(detail).toContain("#/services/demo/resources/app");
	expect(detail).toContain("Descriptor unavailable");
	expect(detail).toContain("No containers");
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

test("service cards put identity first and active/desired revisions side by side without action clutter", () => {
	const html = renderToStaticMarkup(
		<ServicesPage
			services={[
				{ serviceId: "demo", phase: "ready", activeRevision: "active123", desiredRevision: "desired456" },
			]}
		/>,
	);
	expect(html).toMatch(/card-top[^]*<h2>demo<\/h2>[^]*badge-healthy/);
	expect(html).toMatch(/class="service-revisions"[^]*Active revision[^]*active123[^]*Desired revision[^]*desired456/);
	expect(html).not.toContain("View resources");
	expect(html).not.toContain("↗");
	expect(html).not.toContain('eyebrow">Service</span>');
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
	expect(html).toContain('href="#/services/demo/events"');
	expect(html).toContain("Recent events");
});

test("service details put resources before events and the complete descriptor after events", () => {
	const html = renderToStaticMarkup(
		<ServicePage
			service={{
				serviceId: "demo",
				phase: "ready",
				source: { remote: "https://github.com/example/demo.git", descriptorPath: "service.sd.yaml" },
				descriptorStatus: "available",
				descriptorRevision: "abc1234",
				descriptor: {
					version: 1,
					metadata: { serviceId: "demo" },
					resources: { app: { type: "web", image: "app:1" } },
				},
				resources: [
					{ resourceId: "app", type: "web", primaryUrl: "https://demo.example.test", containers: [] },
				],
			}}
			events={events}
		/>,
	);
	expect(html.indexOf("Resources")).toBeLessThan(html.indexOf("Recent events"));
	expect(html.indexOf("Recent events")).toBeLessThan(html.indexOf("Service descriptor"));
	expect(html).toContain('href="https://github.com/example/demo/blob/abc1234/service.sd.yaml"');
	expect(html).toContain('href="https://demo.example.test"');
	expect(html).toContain("app:1");
	expect(html).toContain("&quot;metadata&quot;");
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

test("cluster editor renders masked replacement inputs and marks environment and restart settings", () => {
	const html = renderToStaticMarkup(
		<ClusterPage
			cluster={{
				clusterId: "local",
				config: {},
				revision: "r1",
				fields: [
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
	expect(html).toContain('type="password"');
	expect(html).toContain("Secret value - enter replacement");
	expect(html).toContain("Managed by environment");
	expect(html).toContain("Requires restart");
	expect(html).toContain("Save configuration");
});

test("resource inspection renders configuration, state and escaped log output", () => {
	const resource = {
		resourceId: "app",
		type: "web",
		config: { image: "app:1" },
		containers: [{ id: "c", resourceId: "app", state: "running", imageId: "sha256:a", revision: "rev" }],
	};
	for (const tab of ["config", "state", "logs"] as const) {
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
		if (tab === "config") expect(html).toContain("app:1");
		if (tab === "state") expect(html).toContain("running");
		if (tab === "logs") {
			expect(html).toContain("&lt;script&gt;");
			expect(html).not.toContain("<script>");
		}
	}
});

test("logs select the first observed container by default and preserve an explicit selection", () => {
	const resource = {
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
	expect(initial).toContain('<option value="first" selected="">');
	expect(initial).toContain("Loading logs");
	const explicit = renderToStaticMarkup(
		<ResourcePage serviceId='demo' resource={resource} tab='logs' containerId='second' />,
	);
	expect(explicit).toContain('<option value="second" selected="">');
	const empty = renderToStaticMarkup(
		<ResourcePage serviceId='demo' resource={{ ...resource, containers: [] }} tab='logs' />,
	);
	expect(empty).toContain("No containers available for logs");
});

test("routes distinguish service/resource inspection and reject unsupported navigation", () => {
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
