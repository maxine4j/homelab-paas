import { request as httpRequest } from "node:http";

import Koa from "koa";
import { expect, test, vi } from "vitest";

import { createLogger, createRequestLogger } from "../../util/logger.ts";
import { testConfig } from "../../util/test/config.ts";
import { captureLogs } from "../../util/test/logs.ts";
import { startTestApi } from "../../util/test/router.ts";
import { createAuthRouter } from "./auth-router.ts";
import type { IAuthService } from "./auth-service.ts";

test("forwards only the identity returned by private authorization, without reflecting supplied headers", async () => {
	let decision: Awaited<ReturnType<IAuthService["authorize"]>> = {
		userId: "alice",
		email: "alice@example.test",
		name: "Alice Smith",
	};
	const auth: IAuthService = {
		authorize: async () => decision,
		verifyAuthCookie: vi.fn(),
		beginLogin: vi.fn(),
		completeLogin: vi.fn(),
	};
	const api = await startTestApi(
		new Koa().use(
			createAuthRouter(
				auth,
				testConfig({ services: { demo: { remote: "local", descriptorPath: "/repo/demo.yaml" } } }),
			).routes(),
		),
	);
	try {
		const request = () =>
			requestWithHost(`${api.origin}/auth/check/`, {
				host: "demo.example.test",
				"x-webauth-user": "mallory",
				"x-webauth-email": "mallory@example.test",
				"x-webauth-fullname": "Mallory",
			});
		const response = await request();
		expect(response.status).toBe(200);
		expect(response.headers.get("x-webauth-user")).toBe("alice");
		expect(response.headers.get("x-webauth-email")).toBe("alice@example.test");
		expect(response.headers.get("x-webauth-fullname")).toBe("Alice Smith");
		decision = { userId: "alice", name: "Alice 李" };
		expect((await request()).headers.get("x-webauth-fullname")).toBe(
			Buffer.from("Alice 李", "utf8").toString("latin1"),
		);
		for (decision of ["allowed", "login", "missing", { userId: "alice" }] as const) {
			const result = await request();
			expect(result.headers.get("x-webauth-email")).toBeNull();
			expect(result.headers.get("x-webauth-fullname")).toBeNull();
			expect(result.headers.get("x-webauth-user")).toBe(typeof decision === "object" ? "alice" : null);
		}
	} finally {
		await api.close();
	}
});

test("request logs identify validated auth targets and fixed decisions without credentials", async () => {
	const lines: string[] = [];
	const log = createLogger("http", { write: (line: string) => lines.push(line) });
	log.level = "debug";
	let decision: "allowed" | "login" | "missing" = "allowed";
	let fail = false;
	const auth: IAuthService = {
		authorize: async () => {
			if (fail) throw new Error("store unavailable");
			return decision;
		},
		verifyAuthCookie: () => undefined,
		beginLogin: vi.fn(),
		completeLogin: vi.fn(),
	};
	const api = await startTestApi(
		new Koa().use(createRequestLogger(log)).use(
			createAuthRouter(
				auth,
				testConfig({
					services: {
						demo: { remote: "local", descriptorPath: "/repo/demo.yaml" },
						other: { remote: "local", descriptorPath: "/repo/other.yaml" },
					},
				}),
			).routes(),
		),
	);
	try {
		for (decision of ["allowed", "login", "missing"] as const)
			await requestWithHost(`${api.origin}/auth/check/api/github?token=SECRET`, {
				host: "app.demo.example.test",
				cookie: "__Secure-paas_session=SECRET",
			});
		fail = true;
		await requestWithHost(`${api.origin}/auth/check/api/github`, { host: "app.demo.example.test" });
		await requestWithHost(`${api.origin}/auth/check/api/github`, { host: "SECRET.invalid" });
		await requestWithHost(`${api.origin}/auth/check/api/github`, { host: "example.test" });
		fail = false;
		decision = "login";
		await requestWithHost(`${api.origin}/auth/check//invalid`, { host: "app.demo.example.test" });
		decision = "allowed";
		await requestWithHost(`${api.origin}/auth/check/api/github`, { host: "other.example.test" });
		const records = lines.map((line) => JSON.parse(line));
		expect(records.slice(0, 4).map((record) => record.authReason)).toEqual([
			"allowed",
			"login-required",
			"endpoint-missing",
			"authorization-error",
		]);
		for (const record of records.slice(0, 4))
			expect(record).toMatchObject({
				targetHost: "app.demo.example.test",
				serviceId: "demo",
				targetId: "app.demo",
			});
		expect(records.at(4)).toMatchObject({ authReason: "unknown-host", status: 403 });
		expect(records.at(4)).not.toHaveProperty("targetHost");
		expect(records.at(5)).toMatchObject({ targetHost: "example.test", authReason: "login-required" });
		expect(records.at(5)).not.toHaveProperty("serviceId");
		expect(records.at(6)).toMatchObject({ authReason: "invalid-path", status: 403 });
		expect(records.at(7)).toMatchObject({
			targetHost: "other.example.test",
			serviceId: "other",
			targetId: "other",
			authReason: "allowed",
		});
		expect(lines.join("")).not.toContain("SECRET");
	} finally {
		await api.close();
	}
});

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

test("accepts nested resource OAuth targets and checks their own routing identity", async () => {
	const authorize = vi.fn(async () => "allowed" as const);
	const auth: IAuthService = {
		authorize,
		completeLogin: vi.fn(),
		verifyAuthCookie: vi.fn(),
		beginLogin: () => ({ url: "https://github.com/login", state: "state", nonce: "nonce" }),
	};
	const api = await startTestApi(
		new Koa().use(
			createAuthRouter(
				auth,
				testConfig({ services: { demo: { remote: "local", descriptorPath: "/repo/demo.yaml" } } }),
			).routes(),
		),
	);
	try {
		expect(
			(
				await requestWithHost(
					`${api.origin}/oauth/github/login?redirect_uri=${encodeURIComponent("https://app.demo.example.test/path")}`,
					{ host: "auth.example.test" },
				)
			).status,
		).toBe(302);
		expect((await requestWithHost(`${api.origin}/auth/check/path`, { host: "app.demo.example.test" })).status).toBe(
			200,
		);
		expect(authorize).toHaveBeenCalledWith("app.demo", undefined);
		expect(
			(await requestWithHost(`${api.origin}/auth/check/path`, { host: "app.absent.example.test" })).status,
		).toBe(403);
	} finally {
		await api.close();
	}
});

test("OAuth targets follow added and removed services without rebuilding the router", async () => {
	const config = testConfig();
	const auth: IAuthService = {
		authorize: vi.fn(),
		completeLogin: vi.fn(),
		verifyAuthCookie: vi.fn(),
		beginLogin: () => ({ url: "https://github.com/login", state: "state", nonce: "nonce" }),
	};
	const api = await startTestApi(new Koa().use(createAuthRouter(auth, config).routes()));
	try {
		const login = () =>
			requestWithHost(`${api.origin}/oauth/github/login?redirect_uri=https%3A%2F%2Fdemo.example.test%2F`, {
				host: "auth.example.test",
			});
		expect((await login()).status).toBe(400);
		config.getServices()["demo"] = { remote: "local", descriptorPath: "/repo/demo.yaml" };
		expect((await login()).status).toBe(302);
		delete config.getServices()["demo"];
		expect((await login()).status).toBe(400);
	} finally {
		await api.close();
	}
});

test("maps Envoy checks, strips platform cookies, redirects private requests and fails closed", async () => {
	const capture = captureLogs();
	const authorize = vi.fn(async (id: string, token: string | undefined) =>
		id === "public" || token === "valid" ? ("allowed" as const) : ("login" as const),
	);
	const auth: IAuthService = { authorize, beginLogin: vi.fn(), completeLogin: vi.fn(), verifyAuthCookie: vi.fn() };
	const api = await startTestApi(
		new Koa().use(
			createAuthRouter(
				auth,
				testConfig({
					ingress: { httpPort: 80, baseDomain: "example.test", httpsPort: 443 },
					services: Object.fromEntries(
						["private", "public"].map((id) => [id, { remote: "local", descriptorPath: "/repo/demo.yaml" }]),
					),
					auth: {
						...testConfig().getAuthConfig()!,
						session: { ...testConfig().getAuthConfig()!.session, ttlSeconds: 3600 },
					},
				}),
			).routes(),
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
			createAuthRouter(
				auth,
				testConfig({
					ingress: { httpPort: 80, baseDomain: "example.test", httpsPort: 443 },
					services: Object.fromEntries(
						["private"].map((id) => [id, { remote: "local", descriptorPath: "/repo/demo.yaml" }]),
					),
					auth: {
						...testConfig().getAuthConfig()!,
						session: { ...testConfig().getAuthConfig()!.session, ttlSeconds: 3600 },
					},
				}),
			).routes(),
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
			createAuthRouter(
				auth,
				testConfig({
					ingress: { httpPort: 80, baseDomain: "example.test", httpsPort: 443 },
					services: Object.fromEntries(
						[].map((id) => [id, { remote: "local", descriptorPath: "/repo/demo.yaml" }]),
					),
					auth: {
						...testConfig().getAuthConfig()!,
						session: { ...testConfig().getAuthConfig()!.session, ttlSeconds: 3600 },
					},
				}),
			).routes(),
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
