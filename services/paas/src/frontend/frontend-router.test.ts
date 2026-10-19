import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Koa from "koa";
import { afterEach, expect, test } from "vitest";

import { createHttpServer } from "../start.ts";
import { httpMiddleware } from "../util/http.ts";
import { startTestApi } from "../util/test/router.ts";
import { createFrontendRouter } from "./frontend-router.ts";
import { UiUnavailableError } from "./frontend-service.ts";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "paas-http-"));
	cleanups.push(() => rm(directory, { recursive: true, force: true }));
	await mkdir(join(directory, "assets"));
	await writeFile(join(directory, "index.html"), "<h1>Hello world</h1>");
	await writeFile(join(directory, "assets/app-123.js"), "console.log('hello')");
	const server = await startTestApi(
		createHttpServer({
			uiDirectory: directory,
			logLevel: "silent",
			listen: { host: "127.0.0.1", port: 0 },
		}),
	);
	cleanups.push(() => server.close());
	return server;
}

test("API and static routes retain method, fallback, and cache boundaries", async () => {
	const server = await fixture();
	for (const [method, url, status] of [
		["GET", "/api/health", 200],
		["HEAD", "/api/health", 200],
		["POST", "/api/health", 405],
		["OPTIONS", "/api/health", 405],
		["GET", "/api/health/", 404],
		["GET", "/api/HEALTH", 404],
		["GET", "/api%2fhealth", 200],
		["GET", "/api", 404],
		["GET", "/api/missing", 404],
		["POST", "/api/missing", 404],
		["GET", "/%61pi/missing", 404],
		["GET", "/%ZZ", 400],
		["GET", "/", 200],
		["GET", "/services/example", 200],
		["HEAD", "/services/example", 200],
		["GET", "/api-example", 200],
		["GET", "/assets/app-123.js", 200],
		["GET", "/assets/missing.js", 404],
		["GET", "/missing.js", 404],
		["POST", "/", 405],
		["OPTIONS", "/", 405],
	] as const) {
		const response = await server.inject({ method, url });
		expect(response.statusCode, `${method} ${url}`).toBe(status);
		if (url === "/api" || url.startsWith("/api/"))
			expect(response.headers["content-type"] ?? "").not.toContain("text/html");
	}
	expect((await server.inject("/services/example")).body).toContain("Hello world");
	expect((await server.inject("/api/health")).body).toBe("");
	expect((await server.inject("/%ZZ")).json()).toEqual({
		code: "invalid_request",
		diagnostics: [],
	});
	for (const url of ["/api/health", "/"]) {
		expect((await server.inject({ method: "POST", url })).headers["allow"]).toBe("GET, HEAD");
	}
	expect((await server.inject("/api/missing")).json()).toEqual({
		code: "not_found",
		diagnostics: [],
	});
	expect((await server.inject("/assets/app-123.js")).headers["cache-control"]).toBe(
		"public, max-age=31536000, immutable",
	);
	expect((await server.inject("/")).headers["cache-control"]).toBe("no-cache");
	expect((await server.inject("/assets/missing.js")).headers["cache-control"]).toBe("no-cache");
	expect((await server.inject("/assets/app-123.js")).headers["content-type"]).toContain("javascript");
	expect((await server.inject("/")).headers["content-type"]).toContain("text/html");
});

test("static files cannot escape the UI directory", async () => {
	const server = await fixture();
	for (const url of ["/%2e%2e/package.json", "/assets/%2e%2e/%2e%2e/package.json", "/.env", "/assets/missing"]) {
		const response = await server.inject(url);
		expect(response.statusCode).toBe(404);
	}
});

test("HTTP converts paths and translates service failures without exposing their causes", async () => {
	const paths: string[] = [];
	const server = await startTestApi(
		new Koa().use(httpMiddleware()).use(
			createFrontendRouter({
				async resolve(path) {
					paths.push(path);
					throw new UiUnavailableError({ cause: new Error("secret-canary") });
				},
			}).routes(),
		),
	);
	cleanups.push(() => server.close());
	const response = await server.inject("/services/hello%20world?token=secret-canary");
	expect(paths).toEqual(["/services/hello world"]);
	expect(response.statusCode).toBe(500);
	expect(response.json()).toEqual({
		statusCode: 500,
		error: "Internal Server Error",
		message: "UI content is unavailable",
	});
	expect(response.body).not.toContain("canary");
	await server.inject("/api/health");
	await server.inject("/api/missing");
	expect(paths).toHaveLength(1);
});

test("the frontend router composes independently and leaves API requests to other routers", async () => {
	const paths: string[] = [];
	const router = createFrontendRouter({
		async resolve(path) {
			paths.push(path);
			return { kind: "missing" };
		},
	});
	const server = await startTestApi(new Koa().use(router.routes()));
	cleanups.push(() => server.close());
	expect((await server.inject("/api/health")).statusCode).toBe(404);
	expect((await server.inject("/api/missing")).statusCode).toBe(404);
	expect(paths).toEqual([]);
	expect((await server.inject("/services/example")).statusCode).toBe(404);
	expect(paths).toEqual(["/services/example"]);
});
