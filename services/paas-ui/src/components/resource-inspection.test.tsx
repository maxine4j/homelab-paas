import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ResourceConfiguration } from "./resource-configuration.tsx";
import { ResourceState } from "./resource-state.tsx";

test("configuration presents image, deployment, inline ingress, environment rows and a collapsed YAML descriptor", () => {
	const html = renderToStaticMarkup(
		<ResourceConfiguration
			config={{
				type: "web",
				image: "app:1",
				replicas: 1,
				rolloutStrategy: "surge",
				ingress: { port: 8080, public: false },
				env: [
					{ name: "NODE_ENV", value: "production" },
					{ name: "TOKEN", secret: "[redacted]" },
				],
				volumes: [{ hostPath: "/srv/data", mountPath: "/data", readOnly: true }],
				limits: { cpus: 0.5, memoryMiB: 512 },
			}}
			configYaml={"type: web\nimage: app:1\n"}
		/>,
	);
	expect(html).toContain("Image");
	expect(html).toContain("Deployment strategy");
	expect(html).toContain("surge");
	expect(html).toContain("Networking");
	expect(html).toContain("Environment");
	expect(html).toContain("NODE_ENV: production");
	expect(html).toMatch(/TOKEN: <span class="secret-badge"[^>]*>.*<svg[^>]*.*&lt;secret&gt;<\/span>/);
	expect(html).toMatch(
		/<dl class="[^"]*inline-settings[^"]*"><div><dt>Port<\/dt><dd>.*8080.*<\/dd><\/div><div><dt>Public<\/dt><dd>.*No.*<\/dd><\/div><\/dl>/,
	);
	expect(html).toContain("Secrets and commands are redacted.");
	expect(html).toContain("/srv/data");
	expect(html).toContain("Memory (MiB)");
	expect(html).toMatch(/<details[^>]*><summary>Descriptor YAML/);
	expect(html).toContain('aria-label="Resource descriptor YAML"');
	expect(html).toContain("image: app:1\n");
	expect(html).not.toMatch(/<details[^>]* open/);
});

test("configuration uses one card with volume sections and omits the redundant resource type", () => {
	const html = renderToStaticMarkup(
		<ResourceConfiguration
			config={{
				type: "web",
				image: "app:1",
				volumes: [
					{ hostPath: "/var/homelab-paas/codex-runner/codex-home", mountPath: "/data/codex" },
					{ hostPath: "/var/codex-runner/workspace", mountPath: "/workspace" },
				],
				devices: [{ hostPath: "/dev/dri", mountPath: "/dev/dri", permissions: "rwm" }],
				supplementaryGroups: [44],
				custom: "preserved",
			}}
		/>,
	);
	expect(html.match(/class="inspection-panel"/g)).toHaveLength(1);
	expect(html).toContain("<h2>Configuration</h2>");
	expect(html).toContain("<h3>Volumes</h3>");
	expect(html).not.toContain("<dt>Type</dt>");
	expect(html).not.toContain("Storage &amp; devices");
	expect(html).not.toContain("<dt>Devices</dt>");
	expect(html).toContain("/var/homelab-paas/codex-runner/codex-home");
	expect(html).toContain("/workspace");
	expect(html).toContain("/dev/dri");
	expect(html).toContain("44");
	expect(html).toContain("preserved");
});

test("live state groups multiple containers in one card", () => {
	const html = renderToStaticMarkup(
		<ResourceState
			serviceId='demo'
			resourceId='app'
			containers={[
				{ id: "one", resourceId: "app", imageId: "sha256:one", revision: "rev", state: "running" },
				{ id: "two", resourceId: "app", imageId: "sha256:two", revision: "rev", state: "exited" },
			]}
		/>,
	);
	expect(html.match(/class="inspection-panel"/g)).toHaveLength(1);
	expect(html).toContain("<h2>Live state</h2>");
	expect(html).toContain("Container one");
	expect(html).toContain("Container two");
	expect(html).toContain('href="#/services/demo/resources/app/logs/two"');
});

test("live state presents each container, networks and log navigation with an unknown running flag", () => {
	const html = renderToStaticMarkup(
		<ResourceState
			serviceId='demo'
			resourceId='app'
			containers={[
				{
					id: "container-one",
					resourceId: "app",
					imageId: "sha256:image",
					state: "exited",
					revision: "abc1234",
					networks: { internal: { address: "172.20.0.2", aliases: ["app", "web"] } },
				},
			]}
		/>,
	);
	expect(html).toContain("container-one");
	expect(html).toContain("exited");
	expect(html).toContain("Unknown");
	expect(html).toContain("172.20.0.2");
	expect(html).toContain("app, web");
	expect(html).toContain('href="#/services/demo/resources/app/logs/container-one"');
	expect(html).toMatch(/<details[^>]*><summary>Live state JSON/);
	expect(renderToStaticMarkup(<ResourceState serviceId='demo' resourceId='app' containers={[]} />)).toContain(
		"No containers observed",
	);
	expect(renderToStaticMarkup(<ResourceConfiguration />)).toContain("Configuration unavailable");
});
