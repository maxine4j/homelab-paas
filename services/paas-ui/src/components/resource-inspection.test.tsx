import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ResourceConfiguration } from "./resource-configuration.tsx";
import { ResourceState } from "./resource-state.tsx";

test("configuration presents grouped settings, environment and mounts without hiding the JSON disclosure", () => {
	const html = renderToStaticMarkup(
		<ResourceConfiguration
			config={{
				type: "web",
				image: "app:1",
				replicas: 1,
				ingress: { port: 8080, public: false },
				env: [
					{ name: "NODE_ENV", value: "production" },
					{ name: "TOKEN", secret: "[redacted]" },
				],
				volumes: [{ hostPath: "/srv/data", mountPath: "/data", readOnly: true }],
				limits: { cpus: 0.5, memoryMiB: 512 },
			}}
		/>,
	);
	expect(html).toContain("Runtime");
	expect(html).toContain("Networking");
	expect(html).toContain("Environment");
	expect(html).toContain("TOKEN");
	expect(html).toContain("production");
	expect(html).toContain("Secrets and commands are redacted.");
	expect(html).toContain("[redacted]");
	expect(html).toContain("/srv/data");
	expect(html).toContain("Memory (MiB)");
	expect(html).toMatch(/<details[^>]*><summary>Configuration JSON/);
	expect(html).not.toMatch(/<details[^>]* open/);
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
