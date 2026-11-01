import { extname } from "node:path";

import type { Middleware } from "koa";

import { logger } from "../util/logger.ts";
import type { IStaticService } from "./static-service.ts";

export const createStaticRouter =
	(service: IStaticService): Middleware =>
	async (ctx) => {
		if (ctx.method !== "GET" && ctx.method !== "HEAD") {
			ctx.status = 405;
			ctx.set("allow", "GET, HEAD");
			return;
		}
		let path: string;
		try {
			path = decodeURIComponent(ctx.originalUrl.split("?").at(0) ?? "/");
		} catch {
			ctx.status = 400;
			return;
		}
		try {
			const result = await service.resolve(ctx.get("host"), path);
			if (result.kind === "missing") {
				ctx.status = 404;
				return;
			}
			ctx.body = Buffer.from(result.content);
			ctx.type = extname(result.path) || "application/octet-stream";
			ctx.set("cache-control", "no-cache");
			ctx.set("x-content-type-options", "nosniff");
			ctx.status = 200;
		} catch (err) {
			logger.error({ err, operation: "serve_static" }, "Static content is unavailable");
			ctx.status = 503;
		}
	};
