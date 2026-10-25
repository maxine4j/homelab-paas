import { atomicWriteFile, readFile } from "../../src/util/file.ts";
import { test, expect } from "../util/browser-fixtures.ts";
import { waitFor } from "../util/wait.ts";

test.use({ production: true });

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
