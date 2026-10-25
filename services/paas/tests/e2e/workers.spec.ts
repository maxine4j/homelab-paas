import type { ServiceDescriptor, WorkerResource } from "@homelab-paas/shared-contracts";

import { readFile, writeFile } from "../../src/util/file.ts";
import { parseYaml, stringifyYaml } from "../../src/util/yaml.ts";
import { test, expect } from "../util/browser-fixtures.ts";
import { waitFor } from "../util/wait.ts";

test("workers stay private through rollout, failed health checks, recovery and restart", async ({
	environment: env,
}) => {
	const worker = (version: string, ready = true): WorkerResource => ({
		type: "worker",
		image: env.image,
		replicas: 2,
		rolloutStrategy: "surge",
		healthcheckPort: 8080,
		healthcheckUrl: "/health",
		termination: { timeoutSeconds: 2 },
		env: [
			{ name: "VERSION", value: version },
			{ name: "READY", value: String(ready) },
		],
	});
	const descriptor = (resource: WorkerResource) =>
		JSON.stringify({ version: 1, metadata: { serviceId: "workers" }, resources: { jobs: resource } });
	await env.git.commit({ "workers.sd.yaml": descriptor(worker("v1")) });
	env.config.services["workers"] = { remote: env.git.remote, branch: "main", descriptorPath: "workers.sd.yaml" };
	await writeFile(`${env.directory}/etc/config.yaml`, stringifyYaml(env.config), { mode: 0o600 });
	await env.compose(["restart", "paas"]);
	await waitFor("worker-only service ready", async () => (await env.checkpoint("workers"))?.phase === "ready");
	const original = await env.workloadIds("workers");
	expect(original).toHaveLength(2);
	for (const id of original) {
		const [container] = JSON.parse(await env.docker(["inspect", id]));
		expect(Object.keys(container.HostConfig.PortBindings ?? {})).toEqual([]);
		expect(container.Config.Labels["homelab-paas.resource"]).toBe("jobs");
	}
	const routes = () => readFile(`${env.directory}/var/_paas/routes.yaml`);
	expect(await routes()).not.toContain("workers");
	expect(
		(await env.request(env.url("workers", "/health"), `__Secure-paas_session=${env.session()}`)).status,
	).not.toBe(200);
	const webIds = await env.workloadIds("public");
	const mixed = parseYaml(await env.descriptor("public", "v1"), "mixed descriptor") as ServiceDescriptor;
	mixed.resources["jobs"] = worker("v1");
	const update = await env.git.commit({
		"public.sd.yaml": JSON.stringify(mixed),
		"workers.sd.yaml": descriptor(worker("v2")),
	});
	await waitFor(
		"mixed service and worker rollout ready",
		async () =>
			(await env.checkpoint("public"))?.activeRevision === update
			&& (await env.checkpoint("workers"))?.activeRevision === update,
	);
	expect(await env.workloadIds("public")).toHaveLength(3);
	expect(await env.workloadIds("public")).toContain(webIds.at(0));
	expect((await env.request(env.url("public", "/version"))).status).toBe(200);
	const active = await env.workloadIds("workers");
	expect(active.some((id) => original.includes(id))).toBe(false);
	await env.git.commit({ "workers.sd.yaml": descriptor(worker("bad", false)) });
	await waitFor("unhealthy worker surge rejected", async () => (await env.checkpoint("workers"))?.phase === "failed");
	for (const id of active) expect(await env.workloadIds("workers")).toContain(id);
	const revision = await env.git.commit({ "workers.sd.yaml": descriptor(worker("v3")) });
	await waitFor("worker retry recovered", async () => (await env.checkpoint("workers"))?.activeRevision === revision);
	const recovered = await env.workloadIds("workers");
	expect(recovered).toHaveLength(2);
	await env.docker(["rm", "-f", recovered.at(0)!]);
	await waitFor("missing worker replica replaced", async () => {
		const ids = await env.workloadIds("workers");
		return ids.length === 2 && !ids.includes(recovered.at(0)!);
	});
	expect(await env.workloadIds("workers")).toContain(recovered.at(1));
	const beforeRestart = await env.workloadIds("workers");
	await env.compose(["restart", "paas"]);
	await env.waitReady("public", "v1");
	expect(await env.workloadIds("workers")).toEqual(beforeRestart);
	expect(await routes()).not.toContain("workers");
});
