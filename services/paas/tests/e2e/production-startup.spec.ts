import { atomicWriteFile, readFile, mkdir, readdir } from "../../src/util/file.ts";
import { test, expect } from "../util/browser-fixtures.ts";
import { waitFor } from "../util/wait.ts";

test.use({ production: true });

test("production startup uses the isolated Envoy directory and cleans obsolete internal output only", async ({
	environment: env,
}) => {
	const [envoy] = JSON.parse(await env.docker(["inspect", (await env.compose(["ps", "-q", "envoy"])).trim()]));
	expect(envoy.Mounts.map((mount: { Destination: string }) => mount.Destination)).toEqual([
		"/var/homelab-paas/_paas/envoy",
	]);
	expect(envoy.Config.Cmd).toEqual(["-c", "/var/homelab-paas/_paas/envoy/envoy.yaml"]);
	await env.compose(["stop", "paas"]);
	const root = `${env.directory}/var`;
	const obsolete = [
		"_paas/gone.state.yaml",
		"_paas/gone.events.yaml",
		"_paas/git/private/" + "f".repeat(64) + "/HEAD",
		"_paas/ui-git/gone/HEAD",
		"_paas/static/gone/site/index.html",
		"__paas/static/gone/site/index.html",
	];
	const retained = ["private/data/keep", "private/credentials.env"];
	for (const name of [...obsolete, ...retained]) {
		const path = `${root}/${name}`;
		await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true, mode: 0o700 });
		await atomicWriteFile(path, "sentinel", { mode: 0o600 });
	}
	const pem = await readFile(`${root}/_paas/envoy/ingress.pem`);
	await env.compose(["start", "paas"]);
	await waitFor("obsolete internal artifacts removed", async () =>
		(await Promise.all(obsolete.map((name) => readFile(`${root}/${name}`)))).every((value) => value === undefined),
	);
	for (const name of retained) expect(await readFile(`${root}/${name}`)).toBe("sentinel");
	expect(await readFile(`${root}/_paas/envoy/ingress.pem`)).toBe(pem);
	expect((await readdir(`${root}/_paas/git/private`)).some((name) => /^[a-f0-9]{64}$/.test(name))).toBe(true);
	expect((await env.request(env.url("public", "/version"))).status).toBe(200);
});

test("the built image's production command deploys and authorizes without test composition", async ({
	environment: env,
}) => {
	const id = (await env.compose(["ps", "-q", "paas"])).trim();
	const [container] = JSON.parse(await env.docker(["inspect", id]));
	expect(container.Config.Cmd).toEqual(["node", "dist/main.js"]);
	expect(container.Config.Env.some((entry: string) => entry.startsWith("MOCK_GITHUB"))).toBe(false);
	expect(container.Mounts.some((mount: { Destination: string }) => mount.Destination.includes("bootstrap.mjs"))).toBe(
		false,
	);
	expect((await env.request(env.url("public", "/version"))).status).toBe(200);
	expect((await env.request(env.url("private", "/version"))).status).toBe(302);
	expect((await env.request(env.url("private", "/version"), `__Secure-paas_session=${env.session()}`)).status).toBe(
		200,
	);
	expect(env.github.server.requests).toHaveLength(0);
	const workloads = await env.workloadIds("private");
	await env.compose(["restart", "paas"]);
	await waitFor(
		"production restart restores authenticated routing",
		async () =>
			(await env.request(env.url("private", "/version"), `__Secure-paas_session=${env.session()}`)).status
			=== 200,
	);
	expect(await env.workloadIds("private")).toEqual(workloads);
	await env.compose(["stop", "paas"]);
	expect(JSON.parse(await env.docker(["inspect", id])).at(0).State).toMatchObject({ Running: false, ExitCode: 0 });
	const path = `${env.directory}/etc/config.yaml`;
	const original = (await readFile(path))!;
	try {
		await atomicWriteFile(path, "invalid: configuration", { mode: 0o600 });
		await env.compose(["up", "-d", "--no-deps", "paas"]);
		await waitFor("fatal startup exit", async () => {
			const [container] = JSON.parse(await env.docker(["inspect", id]));
			return !container.State.Running && container.State.ExitCode === 1;
		});
		expect(await env.compose(["logs", "--no-color", "paas"])).toContain(
			"Fatal process failure: unhandledRejection",
		);
		expect(await env.workloadIds("private")).toEqual(workloads);
	} finally {
		await atomicWriteFile(path, original, { mode: 0o600 });
	}
});
