import { expect, test } from "vitest";

import { readFile } from "../../src/util/file.ts";
import { testConfig } from "../../src/util/test/config.ts";
import { MockDocker } from "../mocks/docker.ts";
import { MockEnvoy } from "../mocks/envoy.ts";
import { artifactDirectory, TestGit } from "../util/git.ts";
import { MockHttpServer } from "../util/http-server.ts";
import { inProcessPaas } from "../util/in-process-paas.ts";

test("real Git, Docker socket and xDS transports preserve serving state through failures and retries", async () => {
	const directory = await artifactDirectory("integration");
	const git = new TestGit(directory);
	await git.init();
	const journal: string[] = [];
	const docker = new MockDocker("integration", journal);
	const envoy = new MockEnvoy(`${directory}/state`, journal);
	const health = new MockHttpServer(({ url }) =>
		url.pathname === "/health"
			? new Response("ready")
			: url.pathname === "/unready"
				? new Response("unready", { status: 503 })
				: undefined,
	);
	await docker.server.listen(`${directory}/docker.sock`);
	await envoy.server.listen();
	await health.listen();
	try {
		const descriptor = (serviceId: string, version: string, healthcheckUrl = "/health") =>
			JSON.stringify({
				version: 1,
				metadata: { serviceId },
				resources: {
					app: {
						type: "web",
						image: `fixture-${version}:local`,
						rolloutStrategy: "surge",
						ingress: { public: true, port: Number(new URL(health.url).port) },
						healthcheckUrl,
						env: [{ name: "VERSION", value: version }],
						termination: { timeoutSeconds: 2 },
					},
				},
			});
		let now = 100_000;
		const config = testConfig(
			{
				metadata: { clusterId: "integration" },
				auth: undefined,
				tls: undefined,
				ingress: { baseDomain: "example.test", httpPort: 80 },
				services: {
					demo: { remote: git.remote, branch: "main", descriptorPath: "demo.sd.yaml" },
					other: { remote: git.remote, branch: "main", descriptorPath: "other.sd.yaml" },
				},
			},
			process.env,
		);
		const first = await git.commit({
			"demo.sd.yaml": descriptor("demo", "v1"),
			"other.sd.yaml": descriptor("other", "v1"),
		});
		const paas = await inProcessPaas(
			config,
			`${directory}/state`,
			`${directory}/docker.sock`,
			envoy.server.url,
			() => now,
			async () => {},
		);
		await paas.reconciler.reconcile();
		expect(await paas.checkpoints.read("demo")).toMatchObject({ phase: "ready", activeRevision: first });
		expect(await paas.events.list("demo")).toEqual([
			expect.objectContaining({ event: "deployment.succeeded", revision: first }),
		]);
		const original = [...docker.containers.values()].find(
			(c) => c.Config.Labels["homelab-paas.service"] === "demo",
		)!;
		const create = docker.server.requests.find((r) => r.url.pathname.endsWith("/containers/create"))!;
		expect(JSON.parse(create.body)).toMatchObject({
			Image: "sha256:test-image",
			Env: ["VERSION=v1"],
			HostConfig: { NetworkMode: "paas-integration-demo", RestartPolicy: { Name: "unless-stopped" } },
			Labels: {
				"homelab-paas.cluster": "integration",
				"homelab-paas.service": "demo",
				"homelab-paas.revision": first,
			},
		});
		expect(JSON.parse(create.body).HostConfig.PortBindings).toBeUndefined();
		await paas.reconciler.reconcile();
		expect(docker.containers.has(original.Id)).toBe(true);
		const second = await git.commit({ "demo.sd.yaml": descriptor("demo", "v2") });
		journal.length = 0;
		await paas.reconciler.reconcile();
		expect(await paas.checkpoints.read("demo")).toMatchObject({ phase: "ready", activeRevision: second });
		expect(journal.indexOf("POST /containers/create")).toBeLessThan(
			journal.indexOf(`POST /containers/${original.Id}/stop`),
		);
		expect(journal.findIndex((entry) => entry.includes("envoy:paas,service-app.demo"))).toBeLessThan(
			journal.indexOf(`POST /containers/${original.Id}/stop`),
		);
		expect(docker.containers.has(original.Id)).toBe(false);
		const active = [...docker.containers.values()].find((c) => c.Config.Labels["homelab-paas.service"] === "demo")!;
		await git.commit({
			"demo.sd.yaml": descriptor("demo", "bad", "/unready"),
			"other.sd.yaml": descriptor("other", "v2"),
		});
		await paas.reconciler.reconcile();
		expect(await paas.checkpoints.read("demo")).toMatchObject({
			phase: "deploying",
			deploymentStartedAt: now,
			activeRevision: second,
			failures: 1,
			retryAt: now + 1000,
		});
		expect(docker.containers.has(active.Id)).toBe(true);
		expect(await paas.checkpoints.read("other")).toMatchObject({ phase: "ready" });
		await git.commit({ "demo.sd.yaml": descriptor("demo", "v3") });
		await paas.reconciler.reconcile();
		expect(docker.containers.has(active.Id)).toBe(true);
		now += 1000;
		await paas.reconciler.reconcile();
		expect(await paas.checkpoints.read("demo")).toMatchObject({ phase: "ready" });
		expect(docker.containers.has(active.Id)).toBe(false);
		const routes = await readFile(`${directory}/state/routes.yaml`);
		await git.commit({ "demo.sd.yaml": "invalid: descriptor" });
		await paas.reconciler.reconcile();
		expect(await readFile(`${directory}/state/routes.yaml`)).toBe(routes);
		envoy.reject = true;
		now += 1000;
		await git.commit({ "demo.sd.yaml": descriptor("demo", "v4") });
		await paas.reconciler.reconcile();
		expect(await paas.checkpoints.read("demo")).toMatchObject({ phase: "deploying", deploymentStartedAt: now });
		expect((await paas.events.list("demo")).at(0)).toMatchObject({
			event: "reconciliation.failed",
			resourceId: "app",
			level: "error",
			retryAt: expect.any(Number),
		});
		expect(
			[...docker.containers.values()].filter((c) => c.Config.Labels["homelab-paas.service"] === "demo"),
		).toHaveLength(2);
		const missingSecrets = JSON.parse(descriptor("demo", "v5"));
		missingSecrets.resources.app.env = [
			{ name: "TOKEN", secret: true },
			{ name: "PASSWORD", secret: true },
		];
		await git.commit({ "demo.sd.yaml": JSON.stringify(missingSecrets) });
		now += config.getReconciliationConfig().maxRetryBackoffSeconds * 1000;
		await paas.reconciler.reconcile();
		expect((await paas.events.list("demo")).at(0)).toMatchObject({
			event: "reconciliation.failed",
			resourceId: "app",
			secretFailure: {
				reason: "missing-file",
				filePath: `${directory}/state/env/demo.env`,
				missingVariables: ["TOKEN", "PASSWORD"],
			},
		});
	} finally {
		await Promise.all([docker.server.close(), envoy.server.close(), health.close()]);
	}
});
