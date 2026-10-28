import { expect, test } from "vitest";

import { AuthService } from "../../src/ingress/auth/auth-service.ts";
import { JwtClient } from "../../src/ingress/auth/jwt-client.ts";
import { readFile } from "../../src/util/file.ts";
import { testConfig } from "../../src/util/test/config.ts";
import { parseYaml } from "../../src/util/yaml.ts";
import { MockDocker } from "../mocks/docker.ts";
import { MockEnvoy } from "../mocks/envoy.ts";
import { artifactDirectory, TestGit } from "../util/git.ts";
import { MockHttpServer } from "../util/http-server.ts";
import { inProcessPaas } from "../util/in-process-paas.ts";

test.each([false, true])(
	"independent web resources transfer the primary alias in either descriptor order: reversed=%s",
	async (reversed) => {
		const directory = await artifactDirectory("multiple-web");
		const git = new TestGit(directory);
		await git.init();
		const docker = new MockDocker("multiple-web", []);
		const envoy = new MockEnvoy(`${directory}/state`, []);
		const health = new MockHttpServer(() => new Response("ready"));
		await docker.server.listen(`${directory}/docker.sock`);
		await envoy.server.listen();
		await health.listen();
		const config = testConfig(
			{
				metadata: { clusterId: "multiple-web" },
				services: { demo: { remote: git.remote, branch: "main", descriptorPath: "demo.sd.yaml" } },
			},
			process.env,
		);
		const descriptor = (primary: string) => {
			const entries = ["app", "admin"].map(
				(id) =>
					[
						id,
						{
							type: "web",
							primary: id === primary,
							image: `${id}:local`,
							ingress: { public: id === "app", port: Number(new URL(health.url).port) },
						},
					] as const,
			);
			return JSON.stringify({
				version: 1,
				metadata: { serviceId: "demo" },
				resources: Object.fromEntries(reversed ? entries.reverse() : entries),
			});
		};
		try {
			await git.commit({ "demo.sd.yaml": descriptor("app") });
			const paas = await inProcessPaas(
				config,
				`${directory}/state`,
				`${directory}/docker.sock`,
				envoy.server.url,
				Date.now,
				async () => {},
			);
			await paas.reconciler.reconcile();
			expect(await paas.checkpoints.read("demo")).toMatchObject({ phase: "ready" });
			const workloadIds = () =>
				[...docker.containers.values()]
					.filter((container) => container.Config.Labels["homelab-paas.service"] === "demo")
					.map((container) => container.Id);
			const ids = workloadIds();
			expect(ids).toHaveLength(2);
			const auth = new AuthService(
				{
					getLoginUrl: () => "",
					fetchAccessToken: async () => "",
					fetchUserDetails: async () => ({ userId: "Alice" }),
				},
				new JwtClient(config, Date.now),
				config,
				() => "nonce",
				paas.endpoints,
			);
			expect(await auth.authorize("demo", undefined)).toBe("allowed");
			expect(await auth.authorize("admin.demo", undefined)).toBe("login");
			await git.commit({ "demo.sd.yaml": descriptor("admin") });
			await paas.refresh.refreshAll();
			expect(await paas.checkpoints.read("demo")).toMatchObject({ phase: "ready" });
			expect(workloadIds()).toEqual(ids);
			expect(await auth.authorize("demo", undefined)).toBe("login");
			expect(await auth.authorize("app.demo", undefined)).toBe("allowed");
			const endpoints = await paas.endpoints.getAll();
			expect(
				Object.entries(endpoints)
					.filter(([, endpoint]) => endpoint.primary)
					.map(([id]) => id),
			).toEqual(["admin.demo"]);
			const text = (await readFile(`${directory}/state/lds.yaml`))!;
			expect(text).toContain("admin.demo.example.test");
			expect(text).toContain("app.demo.example.test");
			const document = parseYaml(text, "listeners") as {
				resources: {
					filter_chains: {
						filters: {
							typed_config: { route_config: { virtual_hosts: { name: string; domains: string[] }[] } };
						}[];
					}[];
				}[];
			};
			const hosts = document.resources.flatMap((listener) =>
				listener.filter_chains.flatMap((chain) =>
					chain.filters.flatMap((filter) => filter.typed_config.route_config.virtual_hosts),
				),
			);
			expect(hosts.filter((host) => host.domains.includes("demo.example.test")).map((host) => host.name)).toEqual(
				["admin.demo"],
			);
			const restarted = await inProcessPaas(
				config,
				`${directory}/state`,
				`${directory}/docker.sock`,
				envoy.server.url,
				Date.now,
				async () => {},
			);
			expect(await restarted.endpoints.getAll()).toEqual(endpoints);
			await restarted.reconciler.reconcile();
			expect(workloadIds()).toEqual(ids);
		} finally {
			await Promise.all([docker.server.close(), envoy.server.close(), health.close()]);
		}
	},
);
