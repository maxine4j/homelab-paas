import Koa from "koa";
import { expect, test } from "vitest";

import { captureLogs } from "../util/test/logs.ts";
import { startTestApi } from "../util/test/router.ts";
import { createFrontendRouter } from "./frontend-router.ts";
import { FrontendService, UiUnavailableError } from "./frontend-service.ts";

test("standalone UI routing preserves navigation, asset caching and API boundaries", async () => {
	const frontend = new FrontendService({
		async inspect(path) {
			return path === "assets/app.js" ? "file" : "missing";
		},
		async read(path) {
			return new TextEncoder().encode(path === "index.html" ? "<h1>Hello</h1>" : "console.log('hello')");
		},
	});
	const server = await startTestApi(new Koa().use(createFrontendRouter(frontend).routes()));
	try {
		for (const [path, status] of [
			["/", 200],
			["/services/example", 200],
			["/api/health", 404],
			["/api/missing", 404],
			["/assets/missing.js", 404],
			["/.env", 404],
			["/missing.js", 404],
		] as const) {
			const response = await fetch(`${server.origin}${path}`);
			expect(response.status, path).toBe(status);
			await response.body?.cancel();
		}
		const page = await fetch(`${server.origin}/services/example`);
		expect(await page.text()).toContain("Hello");
		const asset = await fetch(`${server.origin}/assets/app.js`);
		expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
		expect(asset.headers.get("content-type")).toContain("javascript");
		await asset.body?.cancel();
		const post = await fetch(server.origin, { method: "POST" });
		expect(post.status).toBe(405);
		expect(post.headers.get("allow")).toBe("GET, HEAD");
		await post.body?.cancel();
	} finally {
		await server.close();
	}
});

test("UI router decodes paths and sanitizes failures without handling API requests", async () => {
	const paths: string[] = [];
	const capture = captureLogs();
	const server = await startTestApi(
		new Koa().use(
			createFrontendRouter({
				async resolve(path) {
					paths.push(path);
					throw new UiUnavailableError({ cause: new Error("secret-canary") });
				},
			}).routes(),
		),
	);
	try {
		const response = await fetch(`${server.origin}/services/hello%20world?token=secret-canary`);
		expect(paths).toEqual(["/services/hello world"]);
		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			statusCode: 500,
			error: "Internal Server Error",
			message: "UI content is unavailable",
		});
		const api = await fetch(`${server.origin}/api/health`);
		expect(api.status).toBe(404);
		await api.body?.cancel();
		expect(paths).toHaveLength(1);
	} finally {
		await server.close();
		capture.restore();
	}
	expect(capture.lines).toHaveLength(1);
	expect(JSON.parse(capture.lines.at(0)!)).toMatchObject({ operation: "serve_ui", level: 50 });
	expect(capture.lines.join("")).not.toContain("secret-canary");
});
