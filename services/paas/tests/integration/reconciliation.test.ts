import { expect, test } from "vitest";

import { StaticService } from "../../src/static/static-service.ts";
import { StaticStore } from "../../src/static/static-store.ts";
import { readFile } from "../../src/util/file.ts";
import * as files from "../../src/util/file.ts";
import { testConfig } from "../../src/util/test/config.ts";
import { MockDocker } from "../mocks/docker.ts";
import { MockEnvoy } from "../mocks/envoy.ts";
import { artifactDirectory, TestGit } from "../util/git.ts";
import { MockHttpServer } from "../util/http-server.ts";
import { inProcessPaas } from "../util/in-process-paas.ts";

test("pause stops mixed workloads and static ingress across Git refresh, drift audit and restart until explicit resume", async () => {
	const directory = await artifactDirectory("integration-pause");
	const git = new TestGit(directory);
	await git.init();
	const docker = new MockDocker("integration", []);
	const workloads = () =>
		[...docker.containers.values()].filter(
			(container) => container.Config.Labels["homelab-paas.service"] === "demo",
		);
	const envoy = new MockEnvoy(`${directory}/state`, []);
	const health = new MockHttpServer(() => new Response("ready"));
	await docker.server.listen(`${directory}/docker.sock`);
	await envoy.server.listen();
	await health.listen();
	try {
		const config = testConfig({
			metadata: { clusterId: "integration" },
			auth: undefined,
			tls: undefined,
			services: { demo: { remote: git.remote, branch: "main", descriptorPath: "demo.sd.yaml" } },
		});
		const descriptor = (version: string) =>
			JSON.stringify({
				version: 1,
				metadata: { serviceId: "demo" },
				resources: {
					app: {
						type: "web",
						image: "fixture:local",
						ingress: { public: true, port: Number(new URL(health.url).port) },
						env: [{ name: "VERSION", value: version }],
					},
					jobs: {
						type: "worker",
						image: "fixture:local",
						healthcheckPort: Number(new URL(health.url).port),
						replicas: 2,
					},
					site: { type: "static", path: "bundle", ingress: { public: true }, primary: true },
				},
			});
		await files.mkdir(`${directory}/work/bundle`, { recursive: true });
		const first = await git.commit({ "demo.sd.yaml": descriptor("v1"), "bundle/index.html": "first" });
		let paas = await inProcessPaas(
			config,
			`${directory}/state`,
			`${directory}/docker.sock`,
			envoy.server.url,
			() => 100000,
			async () => {},
		);
		await paas.reconciler.reconcile();
		expect((await paas.checkpoints.read("demo"))?.activeRevision).toBe(first);
		expect(workloads().filter((container) => container.State.Running)).toHaveLength(3);
		const staticService = () =>
			new StaticService(config, paas.endpoints, new StaticStore(`${directory}/state`, files));
		expect((await staticService().resolve(`demo.${config.getIngressConfig().baseDomain}`, "/")).kind).toBe("file");
		await paas.scheduler.pause("demo");
		expect(workloads().some((container) => container.State.Running)).toBe(false);
		expect(await paas.endpoints.getAll()).toEqual({});
		expect((await staticService().resolve(`demo.${config.getIngressConfig().baseDomain}`, "/")).kind).toBe(
			"missing",
		);
		const second = await git.commit({ "demo.sd.yaml": descriptor("v2"), "bundle/index.html": "second" });
		await paas.refresh.refreshOne("demo");
		await paas.audit.run();
		await paas.scheduler.settle();
		await paas.management.run();
		expect(await paas.cache.getService("demo")).toMatchObject({
			health: "Paused",
			sync: "OutOfSync",
			desiredRevision: second,
			activeRevision: first,
		});
		await paas.stop();
		paas = await inProcessPaas(
			config,
			`${directory}/state`,
			`${directory}/docker.sock`,
			envoy.server.url,
			() => 100000,
			async () => {},
		);
		await paas.audit.run();
		await paas.scheduler.settle();
		expect((await paas.checkpoints.read("demo"))?.paused).toBe(true);
		expect(workloads().some((container) => container.State.Running)).toBe(false);
		expect(await paas.endpoints.getAll()).toEqual({});
		await expect(paas.scheduler.redeploy("demo")).rejects.toMatchObject({ kind: "paused" });
		await paas.scheduler.resume("demo");
		await paas.scheduler.settle();
		expect(await paas.checkpoints.read("demo")).toMatchObject({ phase: "ready", activeRevision: second });
		expect(workloads().filter((container) => container.State.Running)).toHaveLength(3);
		expect(Object.keys(await paas.endpoints.getAll()).sort()).toEqual(["app.demo", "site.demo"]);
		expect((await staticService().resolve(`demo.${config.getIngressConfig().baseDomain}`, "/")).kind).toBe("file");
	} finally {
		await Promise.all([docker.server.close(), envoy.server.close(), health.close()]);
	}
});

test("real Git, Docker socket and xDS transports preserve serving state through failures and retries", async () => {
	const directory = await artifactDirectory("integration");
	const git = new TestGit(directory);
	await git.init();
	const journal: string[] = [];
	const docker = new MockDocker("integration", journal);
	const envoy = new MockEnvoy(`${directory}/state`, journal);
	const health = new MockHttpServer(({ url }) =>
		url.pathname === "/health" || url.pathname === "/health-v4"
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
			expect.objectContaining({ event: "deployment.started", revision: first }),
		]);
		const original = [...docker.containers.values()].find(
			(c) => c.Config.Labels["homelab-paas.service"] === "demo",
		)!;
		await paas.management.run();
		await paas.cache.getResource("demo", "app");
		await paas.cache.getResource("other", "app");
		paas.writes.length = 0;
		const dockerReads = docker.server.requests.length;
		const publications = envoy.server.requests.length;
		let notifications = 0;
		const unsubscribe = paas.changes.subscribe(() => {
			notifications++;
		});
		for (let pass = 0; pass < 3; pass++) {
			await paas.scheduler.settle();
			await paas.management.run();
			await paas.cache.listServices();
			for (const id of ["demo", "other"]) {
				await paas.cache.getService(id);
				await paas.cache.getResource(id, "app");
			}
		}
		unsubscribe();
		expect(paas.writes).toHaveLength(6);
		expect(paas.writes.every((path) => /\/(demo|other)\/health\.yaml$/.test(path))).toBe(true);
		expect(envoy.server.requests.length - publications).toBe(0);
		expect(notifications).toBe(0);
		expect(docker.server.requests.length - dockerReads).toBe(18);
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
		await paas.reconciler.reconcile();
		expect(await paas.checkpoints.read("demo")).toMatchObject({ activeRevision: first });
		journal.length = 0;
		await paas.refresh.refreshAll();
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
		await paas.refresh.refreshAll();
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
		await paas.refresh.refreshAll();
		expect(docker.containers.has(active.Id)).toBe(true);
		now += 1000;
		await paas.reconciler.reconcile();
		expect(await paas.checkpoints.read("demo")).toMatchObject({ phase: "ready" });
		expect(docker.containers.has(active.Id)).toBe(false);
		const routes = await readFile(`${directory}/state/demo/routes.yaml`);
		await git.commit({ "demo.sd.yaml": "invalid: descriptor" });
		await paas.refresh.refreshAll();
		expect(await readFile(`${directory}/state/demo/routes.yaml`)).toBe(routes);
		envoy.reject = true;
		now += 1000;
		// The mock shares one portable loopback address. Change route content explicitly
		// so this deployment exercises publication rejection rather than confirmed-content reuse.
		await git.commit({ "demo.sd.yaml": descriptor("demo", "v4", "/health-v4") });
		await paas.refresh.refreshAll();
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
		await paas.refresh.refreshAll();
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
