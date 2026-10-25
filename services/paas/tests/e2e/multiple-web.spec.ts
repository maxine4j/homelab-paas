import type { ServiceDescriptor } from "@homelab-paas/shared-contracts";

import { parseYaml, stringifyYaml } from "../../src/util/yaml.ts";
import { test, expect } from "../util/browser-fixtures.ts";
import { waitFor } from "../util/wait.ts";

test("TLS resource hosts keep independent policies and transfer the primary alias without restarting workloads", async ({
	environment: env,
}) => {
	// The implicit single web resource also has its own hostname, with real CA verification.
	expect((await env.request(env.url("app.public", "/version"))).status).toBe(200);
	const descriptor = parseYaml(await env.descriptor("public", "v1"), "descriptor") as ServiceDescriptor;
	const app = descriptor.resources["app"]!;
	if (app.type !== "web") throw new Error("Expected fixture web resource");
	descriptor.resources = {
		app: { ...app, primary: true },
		admin: {
			...app,
			primary: false,
			ingress: { ...app.ingress, public: false },
			env: [{ name: "VERSION", value: "admin" }],
		},
	};
	const first = await env.git.commit({ "public.sd.yaml": stringifyYaml(descriptor) });
	await waitFor(
		"multiple web resources ready",
		async () => (await env.checkpoint("public"))?.activeRevision === first,
	);
	const ids = await env.workloadIds("public");
	expect(ids).toHaveLength(2);
	expect(await (await env.request(env.url("public", "/version"))).json()).toEqual({ version: "v1" });
	const target = env.url("admin.public", "/version");
	const denied = await env.request(target);
	expect(denied.status).toBe(302);
	expect(new URL(denied.headers.get("location")!).searchParams.get("redirect_uri")).toBe(target);
	const login = await env.request(env.url("auth", `/oauth/github/login?redirect_uri=${encodeURIComponent(target)}`));
	expect(login.status).toBe(302);
	const authorization = await fetch(login.headers.get("location")!.replace("host.docker.internal", "127.0.0.1"), {
		redirect: "manual",
	});
	const callback = await env.request(
		authorization.headers.get("location")!,
		login.headers.getSetCookie().at(0)!.split(";").at(0)!,
	);
	expect(callback.status).toBe(302);
	expect(callback.headers.get("location")).toBe(target);
	const session = callback.headers
		.getSetCookie()
		.find((cookie) => cookie.startsWith("__Secure-paas_session="))!
		.split(";")
		.at(0)!;
	await waitFor(
		"private resource receives ready traffic",
		async () => (await env.request(target, session)).status === 200,
	);
	const response = await env.request(env.url("admin.public", "/inspect"), `${session}; app=keep`);
	expect(await response.json()).toEqual({ version: "admin", cookie: "app=keep" });
	const admin = descriptor.resources["admin"]!;
	if (admin.type !== "web") throw new Error("Expected admin web resource");
	descriptor.resources = {
		admin: { ...admin, primary: true },
		app: { ...app, primary: false },
	};
	const second = await env.git.commit({ "public.sd.yaml": stringifyYaml(descriptor) });
	await waitFor("primary transfer ready", async () => (await env.checkpoint("public"))?.activeRevision === second);
	expect((await env.workloadIds("public")).sort()).toEqual(ids.sort());
	expect((await env.request(env.url("public", "/version"))).status).toBe(302);
	expect(await (await env.request(env.url("public", "/version"), session)).json()).toEqual({ version: "admin" });
	expect(await (await env.request(env.url("app.public", "/version"))).json()).toEqual({ version: "v1" });
});
