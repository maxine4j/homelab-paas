import type { ServiceDescriptor } from "@homelab-paas/shared-contracts";

import { mkdir, rm, writeFile } from "../../src/util/file.ts";
import { parseYaml, stringifyYaml } from "../../src/util/yaml.ts";
import { test, expect } from "../util/browser-fixtures.ts";
import { waitFor } from "../util/wait.ts";

test("static bundles retain ingress policy, clean replacements and shared primary routing through real Envoy", async ({
	environment: env,
}) => {
	const descriptor = parseYaml(await env.descriptor("public", "v1"), "descriptor") as ServiceDescriptor;
	const app = descriptor.resources["app"]!;
	if (app.type !== "web") throw new Error("Expected fixture web resource");
	const ids = await env.workloadIds("public");
	await mkdir(`${env.git.work}/bundle`);
	descriptor.resources = {
		app: { ...app, primary: false },
		site: { type: "static", path: "/bundle", primary: true },
		assets: { type: "static", path: "bundle", ingress: { public: true } },
	};
	const first = await env.git.commit({
		"public.sd.yaml": stringifyYaml(descriptor),
		"bundle/index.html": "first static bundle",
		"bundle/old.js": "old asset",
	});
	await waitFor("static bundle ready", async () => (await env.checkpoint("public"))?.activeRevision === first);
	const cookie = `__Secure-paas_session=${env.session()}`;
	expect((await env.request(env.url("site.public"))).status).toBe(302);
	expect((await env.request(env.url("public"))).status).toBe(302);
	expect(await (await env.request(env.url("site.public"), cookie)).text()).toBe("first static bundle");
	expect(await (await env.request(env.url("public"), cookie)).text()).toBe("first static bundle");
	expect(await (await env.request(env.url("assets.public"))).text()).toBe("first static bundle");
	expect((await env.request(env.url("assets.public", "/api/ui/cluster"))).status).toBe(404);
	expect(await (await env.request(env.url("app.public", "/version"))).json()).toEqual({ version: "v1" });
	expect(await env.workloadIds("public")).toEqual(ids);
	await writeFile(`${env.directory}/var/_paas/static/public/assets/stale`, "stale");
	await rm(`${env.git.work}/bundle/old.js`);
	descriptor.resources["site"] = { type: "static", path: "bundle" };
	descriptor.resources["assets"] = { type: "static", path: "/bundle", ingress: { public: true }, primary: true };
	const second = await env.git.commit({
		"public.sd.yaml": stringifyYaml(descriptor),
		"bundle/index.html": "second static bundle",
	});
	await waitFor(
		"static bundle replacement ready",
		async () => (await env.checkpoint("public"))?.activeRevision === second,
	);
	expect(await (await env.request(env.url("public"))).text()).toBe("second static bundle");
	expect((await env.request(env.url("site.public"))).status).toBe(302);
	for (const path of ["/old.js", "/stale"])
		expect((await env.request(env.url("assets.public", path))).status).toBe(404);
	await env.compose(["restart", "paas"]);
	await waitFor("static bundle survives restart", async () => (await env.request(env.url("public"))).status === 200);
	expect(await (await env.request(env.url("public"))).text()).toBe("second static bundle");
	expect(await env.workloadIds("public")).toEqual(ids);
});
