import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { parseRoute } from "../hooks/use-route.ts";
import { ClusterPage } from "./cluster-page.tsx";
import { ResourcePage } from "./resource-page.tsx";
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
	expect(renderToStaticMarkup(<ClusterPage cluster={{ clusterId: "local", config: { version: 1 } }} />)).toContain(
		"Cluster configuration",
	);
	const services = renderToStaticMarkup(<ServicesPage services={[{ serviceId: "demo", phase: "failed" }]} />);
	expect(services).toContain("#/services/demo");
	expect(services).toContain("failed");
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
