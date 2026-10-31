import Koa from "koa";
import { expect, test } from "vitest";

import { startTestApi } from "../util/test/router.ts";
import { createMetricsMiddleware, createMetricsRouter } from "./metrics-router.ts";
import { MetricsService } from "./metrics-service.ts";

test("records successful and thrown HTTP outcomes without URLs or secrets", async () => {
	let time = 0;
	const metrics = new MetricsService("local", "abcdef0123", async () => []);
	const app = new Koa().use(createMetricsMiddleware(metrics, () => time)).use(async (ctx) => {
		time += 100;
		if (ctx.path === "/failure") ctx.throw(403);
		ctx.body = "ok";
	});
	const api = await startTestApi(app);
	try {
		await fetch(`${api.origin}/arbitrary-id?secret=canary`);
		await fetch(`${api.origin}/failure`);
		const output = await metrics.render();
		expect(output).toContain('status="200"} 1');
		expect(output).toContain('status="403"} 1');
		expect(output).toContain('status="403"} 0.1');
		expect(output).not.toMatch(/arbitrary-id|canary|failure/);
	} finally {
		await api.close();
	}
});

test("serves Prometheus text and fails safely when service status is unavailable", async () => {
	let fail = false;
	const metrics = new MetricsService("local", "unknown", async () => {
		if (fail) throw new Error("secret-canary");
		return [];
	});
	const api = await startTestApi(new Koa().use(createMetricsRouter(metrics).routes()));
	try {
		const response = await fetch(`${api.origin}/metrics`);
		expect(response.headers.get("content-type")).toContain("text/plain");
		expect(await response.text()).toContain("# TYPE paas_http_requests_total counter");
		expect((await fetch(`${api.origin}/other`)).status).toBe(404);
		fail = true;
		const failed = await fetch(`${api.origin}/metrics`);
		expect(failed.status).toBe(503);
		expect(await failed.text()).not.toContain("secret-canary");
	} finally {
		await api.close();
	}
});
