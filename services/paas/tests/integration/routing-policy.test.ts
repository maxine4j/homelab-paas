import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import * as files from "../../src/util/file.ts";
import { testConfig } from "../../src/util/test/config.ts";
import { MockDocker } from "../mocks/docker.ts";
import { MockEnvoy } from "../mocks/envoy.ts";
import { artifactDirectory, TestGit } from "../util/git.ts";
import { inProcessPaas } from "../util/in-process-paas.ts";

test.each(["web", "static", "mixed", "mixed-reversed"])(
	"UI links and persisted endpoints share effective primary policy: %s",
	async (mode) => {
		const directory = await artifactDirectory("routing-policy");
		const git = new TestGit(directory);
		await git.init();
		await files.mkdir(`${git.work}/bundle`);
		const journal: string[] = [];
		// Unix sockets have a short platform path limit, independent of checkout depth.
		const socketDirectory = await files.mkdtemp(join(tmpdir(), "paas-route-"));
		const socketPath = join(socketDirectory, "docker.sock");
		const docker = new MockDocker("routing-policy", journal);
		const envoy = new MockEnvoy(`${directory}/state`, []);
		await docker.server.listen(socketPath);
		await envoy.server.listen();
		const config = testConfig({
			metadata: { clusterId: "routing-policy" },
			services: { demo: { remote: git.remote, descriptorPath: "demo.yaml" } },
		});
		const mixed = mode.startsWith("mixed");
		const descriptor = (primary: string) => {
			const entries = [
				[
					"app",
					{
						type: "web",
						image: "app:local",
						ingress: { public: true, port: 8080 },
						primary: mixed && primary === "app",
					},
				],
				["site", { type: "static", path: "bundle", primary: mixed && primary === "site" }],
			].filter(([id]) => mixed || id === (mode === "web" ? "app" : "site"));
			return JSON.stringify({
				version: 1,
				metadata: { serviceId: "demo" },
				resources: Object.fromEntries(mode.endsWith("reversed") ? entries.reverse() : entries),
			});
		};
		try {
			await git.commit({ "demo.yaml": descriptor("app"), "bundle/index.html": "unchanged bundle" });
			const paas = await inProcessPaas(
				config,
				`${directory}/state`,
				socketPath,
				envoy.server.url,
				Date.now,
				async () => {},
			);
			await paas.reconciler.reconcile();
			const workloadIds = () =>
				[...docker.containers.values()]
					.filter((container) => container.Config.Labels["homelab-paas.service"] === "demo")
					.map((container) => container.Id);
			const ids = workloadIds();
			const inode =
				mode === "web" ? undefined : (await files.lstat(`${directory}/state/demo/static/site/index.html`)).ino;
			for (const [index, primary] of (mixed
				? ["app", "site", "app"]
				: [mode === "web" ? "app" : "site"]
			).entries()) {
				if (index > 0) {
					await git.commit({ "demo.yaml": descriptor(primary) });
					await paas.refresh.refreshAll();
				}
				expect(await paas.checkpoints.read("demo")).toMatchObject({ phase: "ready" });
				await paas.management.run();
				const snapshot = await paas.cache.getService("demo");
				expect(snapshot.primaryUrl).toBe("https://demo.example.test");
				for (const resource of snapshot.resources) {
					expect(resource.url).toBe(`https://${resource.resourceId}.demo.example.test`);
					expect(resource.primaryUrl).toBe(
						resource.resourceId === primary ? "https://demo.example.test" : undefined,
					);
				}
				expect(await paas.endpoints.getAll()).toEqual({
					...(mode === "static"
						? {}
						: {
								"app.demo": {
									address: "127.0.0.1",
									port: 8080,
									public: true,
									primary: primary === "app",
								},
							}),
					...(mode === "web"
						? {}
						: {
								"site.demo": {
									address: "127.0.0.1",
									port: 8081,
									static: true,
									public: false,
									primary: primary === "site",
								},
							}),
				});
				expect(workloadIds()).toEqual(ids);
				if (inode !== undefined)
					expect((await files.lstat(`${directory}/state/demo/static/site/index.html`)).ino).toBe(inode);
			}
			if (mode === "static") {
				expect(ids).toEqual([]);
				expect(journal.some((entry) => entry === "POST /networks/create")).toBe(false);
			}
			await paas.stop();
		} finally {
			await Promise.all([docker.server.close(), envoy.server.close()]);
			await files.rm(socketDirectory, { recursive: true, force: true });
		}
	},
);
