import { request as httpRequest } from "node:http";

import Koa from "koa";
import { expect, test, vi } from "vitest";

import { captureLogs } from "../../util/test/logs.ts";
import { startTestApi } from "../../util/test/router.ts";
import { createAuthRouter } from "./auth-router.ts";
import type { IAuthService } from "./auth-service.ts";

const requestWithHost = (url: string, headers: Record<string, string>): Promise<Response> =>
	new Promise((resolve, reject) => {
		const req = httpRequest(url, { headers }, (res) => {
			const chunks: Buffer[] = [];
			res.on("data", (chunk: Buffer) => chunks.push(chunk));
			res.on("end", () => {
				const responseHeaders = new Headers();
				for (const [key, value] of Object.entries(res.headers)) {
					for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value])
						responseHeaders.append(key, item);
				}
				resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: responseHeaders }));
			});
		});
		req.on("error", reject);
		req.end();
	});

test("maps Envoy checks, strips platform cookies, redirects private requests and fails closed", async () => {
	const capture = captureLogs();
	const authorize = vi.fn(async (id: string, token: string | undefined) =>
		id === "public" || token === "valid" ? ("allowed" as const) : ("login" as const),
	);
	const auth: IAuthService = { authorize, beginLogin: vi.fn(), completeLogin: vi.fn(), verifyAuthCookie: vi.fn() };
	const api = await startTestApi(
		new Koa().use(
			createAuthRouter(auth, {
				baseDomain: "example.test",
				httpsPort: 443,
				ttlSeconds: 3600,
				serviceIds: ["private", "public"],
			}).routes(),
		),
	);
	try {
		const check = (host: string, cookie: string) =>
			requestWithHost(`${api.origin}/auth/check/a?b=c`, { host, cookie });
		const publicResponse = await check(
			"public.example.test",
			"app=keep; __Secure-paas_session=SECRET; __Host-paas_oauth=nonce",
		);
		expect(publicResponse.status).toBe(200);
		expect(publicResponse.headers.get("cookie")).toBe("app=keep");
		const privateResponse = await check("private.example.test", "__Secure-paas_session=valid");
		expect(privateResponse.status).toBe(200);
		expect(privateResponse.headers.get("cookie")).toBe("");
		const denied = await check("private.example.test", "");
		expect(denied.status).toBe(302);
		expect(new URL(denied.headers.get("location")!).searchParams.get("redirect_uri")).toBe(
			"https://private.example.test/a?b=c",
		);
		expect((await check("evil.test", "")).status).toBe(403);
		authorize.mockRejectedValue(new Error("SECRET"));
		const failed = await check("public.example.test", "");
		expect(failed.status).toBe(503);
		expect(await failed.text()).not.toContain("SECRET");
	} finally {
		await api.close();
		capture.restore();
	}
	expect(JSON.parse(capture.lines.at(0)!).err.message).toBe("SECRET");
});

test("validates return targets and callback parameters, sets secure cookies and clears OAuth state", async () => {
	const completeLogin = vi.fn(async () => ({ session: "session", redirectUri: "https://private.example.test/" }));
	const auth: IAuthService = {
		authorize: vi.fn(),
		beginLogin: vi.fn(() => ({ url: "https://github.com/login", state: "state", nonce: "nonce" })),
		completeLogin,
		verifyAuthCookie: vi.fn(),
	};
	const api = await startTestApi(
		new Koa().use(
			createAuthRouter(auth, {
				baseDomain: "example.test",
				httpsPort: 443,
				ttlSeconds: 3600,
				serviceIds: ["private"],
			}).routes(),
		),
	);
	try {
		const request = (path: string, cookie = "") =>
			requestWithHost(`${api.origin}${path}`, { host: "auth.example.test", cookie });
		const login = await request("/oauth/github/login?redirect_uri=https%3A%2F%2Fprivate.example.test%2F");
		expect(login.status).toBe(302);
		expect(login.headers.get("set-cookie")).toContain(
			"__Host-paas_oauth=nonce; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600",
		);
		for (const target of [
			"https://evil.test/",
			"https://private.example.test.evil.test/",
			"http://private.example.test/",
			"https://private.example.test:444/",
			"https://user@private.example.test/",
		]) {
			expect((await request(`/oauth/github/login?redirect_uri=${encodeURIComponent(target)}`)).status).toBe(400);
		}
		expect((await request("/auth/callback?code=code")).status).toBe(400);
		const callback = await request("/auth/callback?code=code&state=state", "__Host-paas_oauth=nonce");
		expect(completeLogin).toHaveBeenCalledWith("code", "state", "nonce");
		expect(callback.status).toBe(302);
		expect(callback.headers.getSetCookie()).toContain(
			"__Secure-paas_session=session; Domain=example.test; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600",
		);
		expect(callback.headers.getSetCookie()).toContain(
			"__Host-paas_oauth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
		);
		expect(callback.headers.get("cache-control")).toBe("no-store");
	} finally {
		await api.close();
	}
});
test("management host requires a session, retains its cookie and supports OAuth returns", async () => {
	const auth: IAuthService = {
		authorize: vi.fn(),
		verifyAuthCookie: (token) => (token === "valid" ? { userId: "owner" } : undefined),
		beginLogin: vi.fn(() => ({ url: "https://github.com/login", state: "s", nonce: "n" })),
		completeLogin: vi.fn(),
	};
	const api = await startTestApi(
		new Koa().use(
			createAuthRouter(auth, {
				baseDomain: "example.test",
				httpsPort: 443,
				ttlSeconds: 3600,
				serviceIds: [],
			}).routes(),
		),
	);
	try {
		const check = (cookie: string) =>
			requestWithHost(`${api.origin}/auth/check/api/ui/cluster`, { host: "example.test", cookie });
		expect((await check("")).status).toBe(302);
		const allowed = await check("__Secure-paas_session=valid; app=keep");
		expect(allowed.status).toBe(200);
		expect(allowed.headers.get("cookie")).toBe("__Secure-paas_session=valid; app=keep");
		expect((await check("__Secure-paas_session=valid; __Secure-paas_session=bad")).status).toBe(302);
		const login = await requestWithHost(
			`${api.origin}/oauth/github/login?redirect_uri=https%3A%2F%2Fexample.test%2F`,
			{ host: "auth.example.test" },
		);
		expect(login.status).toBe(302);
		expect(auth.authorize).not.toHaveBeenCalled();
	} finally {
		await api.close();
	}
});
