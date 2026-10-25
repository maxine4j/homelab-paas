import { expect, test } from "vitest";

import { testConfig } from "../../src/util/test/config.ts";
import { MockDocker } from "../mocks/docker.ts";
import { MockEnvoy } from "../mocks/envoy.ts";
import { artifactDirectory, TestGit } from "../util/git.ts";
import { MockHttpServer } from "../util/http-server.ts";
import { inProcessPaas } from "../util/in-process-paas.ts";

test("worker-only reconciliation probes replicas without publishing routes and retries failed surge", async () => {
	const directory = await artifactDirectory("worker-integration");
	const git = new TestGit(directory);
	await git.init();
	const journal: string[] = [];
	const docker = new MockDocker("integration", journal);
	const envoy = new MockEnvoy(`${directory}/state`, journal);
	let healthy = true;
	const health = new MockHttpServer(({ url }) =>
		url.pathname === "/ready" ? new Response("health", { status: healthy ? 200 : 503 }) : undefined,
	);
	await docker.server.listen(`${directory}/docker.sock`);
	await envoy.server.listen();
	await health.listen();
	try {
		let now = 0;
		const descriptor = (version: string) =>
			JSON.stringify({
				version: 1,
				metadata: { serviceId: "jobs" },
				resources: {
					worker: {
						type: "worker",
						image: "worker:local",
						healthcheckPort: Number(new URL(health.url).port),
						healthcheckUrl: "/ready",
						replicas: 2,
						rolloutStrategy: "surge",
						env: [{ name: "VERSION", value: version }],
					},
				},
			});
		await git.commit({ "jobs.sd.yaml": descriptor("v1") });
		const config = testConfig({
			metadata: { clusterId: "integration" },
			auth: undefined,
			tls: undefined,
			services: { jobs: { remote: git.remote, branch: "main", descriptorPath: "jobs.sd.yaml" } },
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
		expect(await paas.checkpoints.read("jobs")).toMatchObject({ phase: "ready" });
		const ids = () =>
			[...docker.containers.values()]
				.filter((container) => container.Config.Labels["homelab-paas.resource"] === "worker")
				.map(({ Id }) => Id);
		const original = ids();
		expect(original).toHaveLength(2);
		expect(await paas.endpoints.getAll()).toEqual({});
		expect(envoy.server.requests).toEqual([]);
		const creations = docker.server.requests.filter(({ url }) => url.pathname.endsWith("/containers/create"));
		expect(new Set(creations.map(({ url }) => url.searchParams.get("name"))).size).toBe(2);
		for (const create of creations) expect(JSON.parse(create.body).HostConfig.PortBindings).toBeUndefined();
		await paas.reconciler.reconcile();
		expect(ids()).toEqual(original);
		healthy = false;
		await git.commit({ "jobs.sd.yaml": descriptor("v2") });
		await paas.reconciler.reconcile();
		expect(await paas.checkpoints.read("jobs")).toMatchObject({ phase: "failed", failures: 1 });
		expect(ids()).toEqual(original);
		healthy = true;
		now = 1000;
		await paas.reconciler.reconcile();
		expect(await paas.checkpoints.read("jobs")).toMatchObject({ phase: "ready" });
		expect(ids()).toHaveLength(2);
		expect(ids().some((id) => original.includes(id))).toBe(false);
		expect(await paas.endpoints.getAll()).toEqual({});
	} finally {
		await Promise.all([docker.server.close(), envoy.server.close(), health.close()]);
	}
});
