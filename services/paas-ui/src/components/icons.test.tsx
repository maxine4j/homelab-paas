import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ClusterPage } from "../pages/cluster-page.tsx";
import { ContainerLogs } from "./container-logs.tsx";
import { ResourceDetailTabs, ServiceDetailTabs } from "./detail-tabs.tsx";
import { EventCopy } from "./event-copy.tsx";
import { GitRefreshFeedback } from "./git-refresh.tsx";
import { ServiceDetailShell } from "./service-detail-shell.tsx";
import { ServiceResources } from "./service-resources.tsx";
import { StatusBadge } from "./status-badge.tsx";

const expectIconWithLabel = (html: string, label: string) => {
	expect(html).toContain(label);
	expect(html).toMatch(/<svg\b[^>]*aria-hidden="true"/);
	expect(html).not.toContain("<title>");
};

test.each([
	["service", <ServiceDetailTabs key='service' serviceId='demo' tab='overview' />, 5],
	["resource", <ResourceDetailTabs key='resource' serviceId='demo' resourceId='web' tab='config' />, 3],
	["cluster", <ClusterPage key='cluster' />, 3],
] as const)("%s tabs pair every readable navigation label with a decorative icon", (_name, view, count) => {
	const html = renderToStaticMarkup(view);
	const tabs = html.match(/<nav class="tabs"[^]*?<\/nav>/)?.[0] ?? "";
	expect(tabs.match(/<svg\b[^>]*aria-hidden="true"/g)).toHaveLength(count);
	expect(tabs.match(/<\/svg>[^<]+<\/a>/g)).toHaveLength(count);
	expect(tabs).toContain('aria-current="page"');
});

test.each(["Health", "Sync"] as const)("%s badge has a decorative icon and retains its axis label", (kind) => {
	const html = renderToStaticMarkup(<StatusBadge kind={kind} status='Unknown' />);
	expectIconWithLabel(html, `aria-label="${kind}: Unknown"`);
});

test("refresh and redeploy keep readable labels and disabled controls alongside their icons", () => {
	const html = renderToStaticMarkup(
		<GitRefreshFeedback serviceId='demo' pending onRefresh={() => {}} onRedeploy={() => {}} />,
	);
	for (const label of ["Refresh", "Redeploy"]) {
		const button = html.match(new RegExp(`<button[^]*?${label}</button>`))?.[0] ?? "";
		expectIconWithLabel(button, label);
		expect(button).toContain("disabled");
	}
});

test("log actions retain their labels alongside decorative icons", () => {
	const html = renderToStaticMarkup(<ContainerLogs content='ready' />);
	expectIconWithLabel(html, "Pause follow");
	expect(html.match(/<svg\b[^>]*aria-hidden="true"/g)).toHaveLength(2);
	expect(html).toContain("Copy recent logs");
});

test("event copy retains its label alongside a decorative icon", () => {
	const html = renderToStaticMarkup(
		<EventCopy
			event={{ timestamp: 1793491200000, level: "info", event: "deployment.succeeded", message: "Ready" }}
		/>,
	);
	expectIconWithLabel(html, "Copy JSON");
});

test("service ingress link retains its destination and text with a decorative external-link icon", () => {
	const html = renderToStaticMarkup(
		<ServiceDetailShell
			serviceId='demo'
			tab='overview'
			service={{
				serviceId: "demo",
				sync: "Synced",
				health: "Healthy",
				source: {},
				descriptorStatus: "available",
				resources: [
					{
						resourceId: "web",
						type: "web",
						sync: "Synced",
						health: "Healthy",
						primaryUrl: "https://demo.example.test",
						containers: [],
					},
				],
			}}
		>
			<p>Overview</p>
		</ServiceDetailShell>,
	);
	const link = html.match(/<a class="primary-web-link"[^]*?<\/a>/)?.[0] ?? "";
	expectIconWithLabel(link, "demo.example.test");
	expect(link).toContain('href="https://demo.example.test" target="_blank" rel="noreferrer"');
});

test.each([true, false])(
	"resource ingress preserves its %s access label and external destination icons",
	(isPublic) => {
		const html = renderToStaticMarkup(
			<ServiceResources
				serviceId='demo'
				resources={[
					{
						resourceId: "web",
						type: "web",
						sync: "Synced",
						health: "Healthy",
						containers: [],
						primaryUrl: "https://demo.example.test",
						config: { ingress: { public: isPublic } },
					},
				]}
			/>,
		);
		const ingress = html.match(/<div class="resource-card-ingress"[^]*?<\/div>/)?.[0] ?? "";
		expectIconWithLabel(ingress, isPublic ? "Public ingress" : "Private ingress");
		expect(ingress.match(/<svg\b[^>]*aria-hidden="true"/g)).toHaveLength(2);
		expect(ingress).toContain('href="https://demo.example.test"');
	},
);
