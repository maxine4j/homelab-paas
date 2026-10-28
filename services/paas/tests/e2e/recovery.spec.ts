import { rename, writeFile } from "../../src/util/file.ts";
import { stringifyYaml } from "../../src/util/yaml.ts";
import { test, expect } from "../util/browser-fixtures.ts";
import { waitFor } from "../util/wait.ts";

for (const operation of ["stop", "remove"] as const)
	test(`recovers a ${operation === "stop" ? "stopped" : "removed"} workload`, async ({ environment: env }) => {
		const [original] = await env.workloadIds("public");
		await env.docker(operation === "stop" ? ["stop", original!] : ["rm", "-f", original!]);
		await waitFor("recovered container identity", async () => {
			const ids = await env.workloadIds("public");
			return ids.length === 1 && ids.at(0) !== original;
		});
		await env.waitReady("public", "v1");
	});

test("control-plane restart restores routes, workload identity and signed sessions", async ({ environment: env }) => {
	const ids = await env.workloadIds("private");
	const cookie = `__Secure-paas_session=${env.session()}`;
	await env.compose(["restart", "paas"]);
	await waitFor(
		"restored authenticated routing",
		async () => (await env.request(env.url("private", "/version"), cookie)).status === 200,
	);
	expect(await env.workloadIds("private")).toEqual(ids);
	await env.waitReady("public", "v1");
});

test("invalid descriptors and Git failure preserve workloads while another service updates", async ({
	environment: env,
}) => {
	const ids = await env.workloadIds("public");
	await env.git.commit({
		"public.sd.yaml": "invalid: descriptor",
		"private.sd.yaml": await env.descriptor("private", "v2"),
	});
	await waitFor("invalid descriptor checkpoint", async () => (await env.checkpoint("public"))?.phase === "failed");
	await env.waitReady("private", "v2");
	expect(await env.workloadIds("public")).toEqual(ids);
	expect((await env.request(env.url("public", "/version"))).status).toBe(200);
	// Join startup refresh with a long interval so the failure request cannot join a fetch begun before removal.
	env.config.git.pollIntervalSeconds = 3600;
	await writeFile(`${env.directory}/etc/config.yaml`, stringifyYaml(env.config), { mode: 0o600 });
	await env.compose(["restart", "paas"]);
	await waitFor(
		"restored private routing before Git failure",
		async () =>
			(await env.request(env.url("private", "/version"), `__Secure-paas_session=${env.session()}`)).status
			=== 200,
	);
	const refreshAll = () =>
		env.request(env.url("", "/api/ui/services/refresh"), `__Secure-paas_session=${env.session()}`, {
			method: "POST",
			headers: { origin: new URL(env.url("")).origin, "x-paas-refresh": "1" },
		});
	const joined = await refreshAll();
	expect(joined.status).toBe(200);
	expect(await joined.json()).toMatchObject({
		results: expect.arrayContaining([{ serviceId: "private", refreshed: true }]),
	});
	const privateCheckpoint = await env.checkpoint("private");
	const privateIds = await env.workloadIds("private");
	await rename(`${env.git.remote}/refs/heads/main`, `${env.git.remote}/refs/heads/unavailable`);
	const refresh = await refreshAll();
	expect(refresh.status).toBe(200);
	expect(await refresh.json()).toMatchObject({
		results: expect.arrayContaining([{ serviceId: "private", refreshed: false }]),
	});
	expect(await env.checkpoint("private")).toEqual(privateCheckpoint);
	expect(privateCheckpoint?.phase).toBe("ready");
	expect(await env.workloadIds("private")).toEqual(privateIds);
	expect(await env.workloadIds("public")).toEqual(ids);
	expect((await env.request(env.url("private", "/version"), `__Secure-paas_session=${env.session()}`)).status).toBe(
		200,
	);
});
