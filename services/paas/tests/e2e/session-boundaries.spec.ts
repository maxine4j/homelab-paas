import { JwtClient } from "../../src/ingress/auth/jwt-client.ts";
import { atomicWriteFile, readFile } from "../../src/util/file.ts";
import { testConfig } from "../../src/util/test/config.ts";
import { test, expect } from "../util/browser-fixtures.ts";
import { waitFor } from "../util/wait.ts";

test("ingress strips platform cookies and rejects invalid sessions and return targets", async ({
	environment: env,
}) => {
	const token = env.session();
	const [header, payload, signature] = token.split(".");
	const tampered = `${header}.${payload}.${signature!.startsWith("A") ? "B" : "A"}${signature!.slice(1)}`;
	for (const service of ["public", "private", "second"]) {
		const response = await env.request(
			env.url(service, "/inspect"),
			`app=yes; __Secure-paas_session=${token}; __Host-paas_oauth=nonce`,
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ version: "v1", cookie: "app=yes" });
	}
	for (const cookie of [
		"",
		"__Secure-paas_session=invalid",
		`__Secure-paas_session=${tampered}`,
		`__Secure-paas_session=${env.session("Alice", Date.now() - 3601_000)}`,
		`__Secure-paas_session=${env.session("Mallory")}`,
		`__Secure-paas_session=${token}; __Secure-paas_session=${token}`,
	]) {
		const response = await env.request(env.url("private", "/original?q=1"), cookie);
		expect(response.status).toBe(302);
		expect(new URL(response.headers.get("location")!).searchParams.get("redirect_uri")).toBe(
			env.url("private", "/original?q=1"),
		);
	}
	for (const path of ["/auth/check", "/api/ui/services", "/"])
		expect((await env.request(env.url("auth", path))).status).toBe(404);
	expect((await env.request(env.url("auth", "/oauth/github/login?redirect_uri=https://evil.test/"))).status).toBe(
		400,
	);
	expect((await env.request(env.url("auth", "/auth/callback?state=invalid&code=code"))).status).toBe(403);
});

test("OAuth state is bound to a browser nonce and expired state cannot log in", async ({ environment: env }) => {
	const login = await env.request(
		env.url("auth", `/oauth/github/login?redirect_uri=${encodeURIComponent(env.url("private", "/version"))}`),
	);
	const authorization = new URL(login.headers.get("location")!);
	const provider = await fetch(authorization.href.replace("host.docker.internal", "127.0.0.1"), {
		redirect: "manual",
	});
	const callback = provider.headers.get("location")!;
	for (const cookie of ["", "__Host-paas_oauth=wrong", "__Host-paas_oauth=duplicate; __Host-paas_oauth=duplicate"])
		expect((await env.request(callback, cookie)).status).toBe(403);
	const validCookie = login.headers.getSetCookie().at(0)!.split(";").at(0)!;
	const altered = new URL(callback);
	altered.searchParams.set("state", `${altered.searchParams.get("state")}tampered`);
	expect((await env.request(altered.href, validCookie)).status).toBe(403);
	const nonce = validCookie.slice("__Host-paas_oauth=".length);
	const expired = new JwtClient(testConfig(env.config), () => Date.now() - 601_000).issue(
		{ nonce, redirectUri: env.url("private", "/version") },
		"state",
	);
	altered.searchParams.set("state", expired);
	expect((await env.request(altered.href, validCookie)).status).toBe(403);
	expect(env.github.server.requests.filter((r) => r.method === "POST")).toHaveLength(0);
	altered.searchParams.set(
		"state",
		new JwtClient(testConfig(env.config), Date.now).issue({ nonce, redirectUri: "https://evil.test/" }, "state"),
	);
	const external = await env.request(altered.href, validCookie);
	expect(external.status).toBe(400);
	expect(external.headers.getSetCookie().some((cookie) => cookie.startsWith("__Secure-paas_session="))).toBe(false);
});

test("authorization errors fail closed for public ingress", async ({ environment: env }) => {
	const filename = `${env.directory}/var/_paas/routes.yaml`;
	const original = (await readFile(filename))!;
	await env.compose(["pause", "paas"]);
	try {
		expect((await env.request(env.url("public", "/version"))).status).toBe(403);
	} finally {
		await env.compose(["unpause", "paas"]);
	}
	await env.waitReady("public", "v1");
	await atomicWriteFile(filename, "invalid: routes", { mode: 0o600 });
	try {
		await waitFor(
			"public request denied on policy-store failure",
			async () => (await env.request(env.url("public", "/version"))).status === 403,
		);
	} finally {
		await atomicWriteFile(filename, original, { mode: 0o600 });
	}
});
