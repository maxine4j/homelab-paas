import Router from "@koa/router";
import type { Middleware } from "koa";

import { createLogger } from "../util/logger.ts";
import type { IMetricsService } from "./metrics-service.ts";

export const createMetricsMiddleware =
	(metrics: IMetricsService, now: () => number): Middleware =>
	async (ctx, next) => {
		const started = now();
		let failureStatus: number | undefined;
		try {
			await next();
		} catch (error) {
			failureStatus =
				error instanceof Error
				&& "status" in error
				&& typeof error.status === "number"
				&& error.status >= 400
				&& error.status <= 599
					? error.status
					: 500;
			throw error;
		} finally {
			metrics.request(ctx.method, failureStatus ?? ctx.status, (now() - started) / 1000);
		}
	};

export const createMetricsRouter = (metrics: IMetricsService): Router => {
	const router = new Router();
	const log = createLogger("metrics");
	router.get("/metrics", async (ctx) => {
		try {
			ctx.body = await metrics.render();
			ctx.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
		} catch (err) {
			log.error({ err }, "Cannot collect service metrics");
			ctx.status = 503;
			ctx.body = "Metrics unavailable";
		}
	});
	return router;
};
