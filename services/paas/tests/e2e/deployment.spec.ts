import { test, expect } from "../util/browser-fixtures.ts";
import { waitFor } from "../util/wait.ts";

test("initial deployment owns isolated resources and unchanged Git keeps the workload", async ({
	environment: env,
}) => {
	// Image IDs must remain usable by this cluster and later tests after host cleanup.
	await env.docker(["system", "prune", "--all", "--force"]);
	const retained = JSON.parse(
		await env.docker([
			"image",
			"inspect",
			process.env["PLAYWRIGHT_IMAGE"] ?? "homelab-paas/playwright:ci",
			"envoyproxy/envoy:v1.37.0",
			env.paasImage,
			env.image,
		]),
	);
	expect(retained).toHaveLength(4);
	const [id] = await env.workloadIds("public");
	expect(id).toBeTruthy();
	const [container] = JSON.parse(await env.docker(["inspect", id!]));
	const [image] = JSON.parse(await env.docker(["image", "inspect", env.image]));
	expect(container.Config.Image).toBe(image.Id);
	expect(container.Image).toBe(image.Id);
	expect(container.Config.Labels).toMatchObject({
		"homelab-paas.cluster": env.cluster,
		"homelab-paas.service": "public",
		"homelab-paas.resource": "app",
		"homelab-paas.revision": (await env.checkpoint("public"))!.activeRevision,
	});
	expect(Object.keys(container.HostConfig.PortBindings ?? {})).toEqual([]);
	expect(Object.values(container.NetworkSettings.Ports ?? {}).flatMap((bindings) => bindings ?? [])).toEqual([]);
	expect(Object.keys(container.NetworkSettings.Networks)).toEqual([`paas-${env.cluster}-public`]);
	const network = JSON.parse(await env.docker(["network", "inspect", `paas-${env.cluster}-public`])).at(0);
	expect(network.Labels).toMatchObject({ "homelab-paas.cluster": env.cluster, "homelab-paas.service": "public" });
	expect(Object.keys(network.Containers)).toHaveLength(3);
	const revision = await env.git.commit({ "note.txt": "Unrelated committed change" });
	await waitFor(
		"unchanged revision checkpoint",
		async () => (await env.checkpoint("public"))?.activeRevision === revision,
	);
	expect(await env.workloadIds("public")).toEqual([id]);
	expect((await env.request(env.url("public", "/version"))).status).toBe(200);
});

for (const strategy of ["recreate", "surge"])
	test(`${strategy} serves committed updates and retires the previous container`, async ({ environment: env }) => {
		const previous = await env.workloadIds("public");
		const revision = await env.update("public", "v2", strategy);
		await env.waitReady("public", "v2");
		expect(await env.checkpoint("public")).toMatchObject({
			phase: "ready",
			activeRevision: revision,
			desiredRevision: revision,
		});
		expect(await env.workloadIds("public")).toHaveLength(1);
		expect(await env.workloadIds("public")).not.toEqual(previous);
		for (const id of previous) expect((await env.docker(["ps", "-aq", "--filter", `id=${id}`])).trim()).toBe("");
	});

test("failed surge readiness preserves the serving revision", async ({ environment: env }) => {
	const previous = await env.workloadIds("public");
	const active = (await env.checkpoint("public"))!.activeRevision;
	const desired = await env.update("public", "unready", "surge", false);
	await waitFor("failed surge attempt during deployment grace", async () => {
		const checkpoint = await env.checkpoint("public");
		return checkpoint?.desiredRevision === desired && (checkpoint.failures ?? 0) > 0;
	});
	expect(await env.checkpoint("public")).toMatchObject({
		phase: "deploying",
		activeRevision: active,
		desiredRevision: desired,
	});
	expect(await env.workloadIds("public")).toContain(previous.at(0));
	expect(await (await env.request(env.url("public", "/version"))).json()).toEqual({ version: "v1" });
});
