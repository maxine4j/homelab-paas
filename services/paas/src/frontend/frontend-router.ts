import { extname } from "node:path";

import Router from "@koa/router";

import { logger } from "../util/logger.ts";
import type { Frontend } from "./frontend-service.ts";
import { UiUnavailableError } from "./frontend-service.ts";

const frontendPath = /^(?!\/api(?:\/|$)).*/;

export function createFrontendRouter(frontend: Frontend) {
	const router = new Router();
	router.get(frontendPath, async (context) => {
		const path = decodeURIComponent(context.originalUrl.split("?").at(0) ?? "/");
		try {
			const result = await frontend.resolve(path);
			if (result.kind === "missing") {
				context.status = 404;
				return;
			}
			context.body = Buffer.from(result.content);
			context.type = extname(result.path) || "application/octet-stream";
			context.status = 200;
			if (path.startsWith("/assets/")) context.set("cache-control", "public, max-age=31536000, immutable");
		} catch (error) {
			logger.error({ operation: "serve_ui", err: error }, "UI content is unavailable");
			context.status = 500;
			context.body = {
				statusCode: 500,
				error: "Internal Server Error",
				message: error instanceof UiUnavailableError ? error.message : "Internal Server Error",
			};
		}
	});
	router.all(frontendPath, (context) => {
		context.status = 405;
		context.set("allow", "GET, HEAD");
	});
	return router;
}
