import { once } from "node:events";

import Koa from "koa";
import { expect, test } from "vitest";

import { createAuthRouter } from "../../src/ingress/auth/auth-router.ts";
import { AuthService } from "../../src/ingress/auth/auth-service.ts";
import { JwtClient } from "../../src/ingress/auth/jwt-client.ts";
import { GitHubOauth2Provider } from "../../src/ingress/auth/oauth-provider/github.ts";
import { EndpointsStore } from "../../src/reconciler/networking/endpoints-store.ts";
import { InMemoryKeyValueStore } from "../../src/store/in-memory-store.ts";
import { testConfig } from "../../src/util/test/config.ts";
import { MockGitHub } from "../mocks/github.ts";
import { requestHttp } from "../util/http-server.ts";

test("real OAuth composition enforces state, provider protocol, allowlist and cookie boundaries", async () => {
	const github = new MockGitHub();
	await github.server.listen();
	const config = testConfig({
		services: {
			demo: { remote: "repo", descriptorPath: "demo.sd.yaml" },
			other: { remote: "repo", descriptorPath: "other.sd.yaml" },
		},
		auth: {
			...testConfig().getAuthConfig()!,
			github: { clientId: "test-client", clientSecret: "test-secret", allowedUsers: ["Alice"] },
		},
	});
	let now = Date.now();
	const tokens = new JwtClient(config, () => now);
	const state = new InMemoryKeyValueStore<unknown>();
	const endpoints = new EndpointsStore(state);
	await endpoints.set("demo", { address: "127.0.0.1", port: 8080, public: false, healthcheckPath: "/health" });
	await endpoints.set("other", { address: "127.0.0.1", port: 8080, public: true, healthcheckPath: "/health" });
	const auth = new AuthService(
		new GitHubOauth2Provider(config, fetch, github.endpoints()),
		tokens,
		config,
		() => "browser-nonce",
		endpoints,
	);
	const server = new Koa().use(createAuthRouter(auth, config).routes()).listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing listener");
	const request = (path: string, host = "auth.example.test", cookie = "") =>
		requestHttp(`http://127.0.0.1:${address.port}${path}`, { host, cookie });
	const target = "https://demo.example.test/original?q=one%20two";
	const login = async () => {
		const response = await request(`/oauth/github/login?redirect_uri=${encodeURIComponent(target)}`);
		expect(response.status).toBe(302);
		expect(response.headers.get("set-cookie")).toContain(
			"__Host-paas_oauth=browser-nonce; Path=/; HttpOnly; Secure; SameSite=Lax",
		);
		const authorization = await fetch(response.headers.get("location")!, { redirect: "manual" });
		return new URL(authorization.headers.get("location")!);
	};
	try {
		const callback = await login();
		const response = await request(
			callback.pathname + callback.search,
			"auth.example.test",
			"__Host-paas_oauth=browser-nonce",
		);
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(target);
		const cookies = response.headers.getSetCookie();
		expect(cookies).toContainEqual(
			expect.stringContaining("Domain=example.test; Path=/; HttpOnly; Secure; SameSite=Lax"),
		);
		expect(cookies).toContainEqual(expect.stringContaining("Max-Age=0"));
		const session = cookies
			.find((c) => c.startsWith("__Secure-paas_session="))!
			.split(";")
			.at(0)!;
		expect(github.server.requests.map((r) => [r.method, r.url.pathname])).toEqual([
			["GET", "/authorize"],
			["POST", "/token"],
			["GET", "/user"],
		]);
		expect(JSON.parse(github.server.requests.at(1)!.body)).toEqual({
			client_id: "test-client",
			client_secret: "test-secret",
			code: callback.searchParams.get("code"),
			redirect_uri: "https://auth.example.test/auth/callback",
		});
		const allowed = await request(
			"/auth/check/original?q=1",
			"demo.example.test",
			`${session}; __Host-paas_oauth=nonce; app=yes`,
		);
		expect(allowed.status).toBe(200);
		expect(allowed.headers.get("cookie")).toBe("app=yes");
		expect((await request("/auth/check/", "example.test", session)).headers.get("cookie")).toBe(session);
		for (const cookie of [
			"",
			`${session}; ${session}`,
			"__Secure-paas_session=tampered",
			`__Secure-paas_session=${tokens.issue({ userId: "Mallory" }, "session")}`,
		])
			expect((await request("/auth/check/", "demo.example.test", cookie)).status).toBe(302);
		now += 3601_000;
		expect((await request("/auth/check/", "demo.example.test", session)).status).toBe(302);
		for (const nonce of [
			"",
			"__Host-paas_oauth=wrong",
			"__Host-paas_oauth=browser-nonce; __Host-paas_oauth=browser-nonce",
		]) {
			const attempt = await login();
			expect((await request(attempt.pathname + attempt.search, "auth.example.test", nonce)).status).toBe(403);
		}
		expect(
			(
				await request(
					"/auth/callback?code=code&state=tampered",
					"auth.example.test",
					"__Host-paas_oauth=browser-nonce",
				)
			).status,
		).toBe(403);
		expect((await request("/oauth/github/login?redirect_uri=https://evil.test/")).status).toBe(400);
		github.user = "Mallory";
		const denied = await login();
		expect(
			(await request(denied.pathname + denied.search, "auth.example.test", "__Host-paas_oauth=browser-nonce"))
				.status,
		).toBe(403);
		github.user = "Alice";
		for (const failure of ["failToken", "failProfile"] as const) {
			github[failure] = true;
			const attempt = await login();
			expect(
				(
					await request(
						attempt.pathname + attempt.search,
						"auth.example.test",
						"__Host-paas_oauth=browser-nonce",
					)
				).status,
			).toBe(403);
			github[failure] = false;
		}
		expect((await request("/auth/check/", "other.example.test")).status).toBe(200);
		await state.set("routes", "corrupt");
		expect((await request("/auth/check/", "other.example.test")).status).toBe(503);
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		await github.server.close();
	}
});
