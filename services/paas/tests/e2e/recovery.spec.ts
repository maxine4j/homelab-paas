import { rename } from "../../src/util/file.ts";
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
	await rename(`${env.git.remote}/refs/heads/main`, `${env.git.remote}/refs/heads/unavailable`);
	await waitFor("Git failure checkpoint", async () => (await env.checkpoint("private"))?.phase === "failed");
	expect(await env.workloadIds("public")).toEqual(ids);
	expect((await env.request(env.url("private", "/version"), `__Secure-paas_session=${env.session()}`)).status).toBe(
		200,
	);
});
