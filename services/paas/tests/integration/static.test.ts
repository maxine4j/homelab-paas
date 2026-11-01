import { request } from "node:http";

import Koa from "koa";
import { expect, test } from "vitest";

import { createStaticRouter } from "../../src/static/static-router.ts";
import { StaticService } from "../../src/static/static-service.ts";
import { StaticStore } from "../../src/static/static-store.ts";
import * as files from "../../src/util/file.ts";
import { testConfig } from "../../src/util/test/config.ts";
import { startTestApi } from "../../src/util/test/router.ts";
import { MockDocker } from "../mocks/docker.ts";
import { MockEnvoy } from "../mocks/envoy.ts";
import { artifactDirectory, TestGit } from "../util/git.ts";
import { inProcessPaas } from "../util/in-process-paas.ts";

test("committed static bundles reconcile through real Git, disk, xDS and HTTP with clean replacements", async () => {
	const directory = await artifactDirectory("static-integration");
	const git = new TestGit(directory);
	await git.init();
	await files.mkdir(`${git.work}/bundle`);
	const descriptor = JSON.stringify({
		version: 1,
		metadata: { serviceId: "demo" },
		resources: { site: { type: "static", path: "bundle", ingress: { public: true } } },
	});
	const first = await git.commit({ "demo.yaml": descriptor, "bundle/index.html": "first", "bundle/old.js": "old" });
	const docker = new MockDocker("static-integration", []);
	const envoy = new MockEnvoy(`${directory}/state`, []);
	await docker.server.listen(`${directory}/docker.sock`);
	await envoy.server.listen();
	const config = testConfig(
		{
			services: { demo: { remote: git.remote, descriptorPath: "demo.yaml" } },
			auth: undefined,
			tls: undefined,
			ingress: { baseDomain: "example.test", httpPort: 80 },
		},
		process.env,
	);
	const paas = await inProcessPaas(
		config,
		`${directory}/state`,
		`${directory}/docker.sock`,
		envoy.server.url,
		Date.now,
		async () => {},
	);
	const store = new StaticStore(`${directory}/state/static`, files);
	const api = await startTestApi(new Koa().use(createStaticRouter(new StaticService(config, paas.endpoints, store))));
	const get = (path: string, host = "site.demo.example.test"): Promise<{ status: number; body: string }> =>
		new Promise((resolve, reject) => {
			request(`${api.origin}${path}`, { headers: { host } }, (response) => {
				let body = "";
				response.setEncoding("utf8");
				response.on("data", (chunk: string) => {
					body += chunk;
				});
				response.on("end", () => resolve({ status: response.statusCode!, body }));
			})
				.on("error", reject)
				.end();
		});
	try {
		await paas.reconciler.reconcile();
		expect(await paas.checkpoints.read("demo")).toMatchObject({ phase: "ready", activeRevision: first });
		expect(await get("/")).toEqual({ status: 200, body: "first" });
		expect(await get("/", "demo.example.test")).toEqual({ status: 200, body: "first" });
		expect((await get("/api/ui/cluster")).status).toBe(404);
		expect((await get("/", "example.test")).status).toBe(404);
		expect((await get("/%2e%2e/demo.yaml")).status).toBe(404);
		await files.writeFile(`${directory}/state/static/demo/site/stale`, "stale");
		await files.rm(`${git.work}/bundle/old.js`);
		const second = await git.commit({ "bundle/index.html": "second" });
		await files.writeFile(`${git.work}/bundle/index.html`, "uncommitted");
		await paas.git.refreshFile("demo", config.getServices()["demo"]!);
		await paas.reconciler.reconcile();
		expect(await paas.checkpoints.read("demo")).toMatchObject({ phase: "ready", activeRevision: second });
		expect(await get("/")).toEqual({ status: 200, body: "second" });
		expect((await get("/old.js")).status).toBe(404);
		expect((await get("/stale")).status).toBe(404);
		await paas.management.run();
		expect(await paas.cache.getResource("demo", "site")).toMatchObject({
			sync: "Synced",
			health: "Healthy",
			containers: [],
		});
		await files.writeFile(`${directory}/state/static/demo/site/index.html`, "tampered");
		await paas.audit.run("demo");
		await paas.scheduler.settle();
		expect(await get("/")).toEqual({ status: 200, body: "second" });
	} finally {
		await paas.stop();
		await api.close();
		await docker.server.close();
		await envoy.server.close();
	}
});
