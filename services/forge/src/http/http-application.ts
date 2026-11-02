import { createLogger } from "@homelab-paas/backend-infrastructure/logger";
import { bodyParser } from "@koa/bodyparser";
import type Router from "@koa/router";
import Koa from "koa";

import { AccessDeniedError, type IAccessService } from "../auth/access-service.ts";
import type { Actor } from "../auth/types.ts";
import { InvalidProjectError, ProjectNotFoundError, ProjectUnavailableError } from "../projects/errors.ts";
import type { IProjectRouter } from "../projects/project-router.ts";

export interface IHttpApplication {
	create(extensions?: IHttpRouter[]): Koa;
}
export interface IHttpRouter {
	create(): Router<{ actor: Actor }>;
}
export class HttpApplication implements IHttpApplication {
	private readonly log = createLogger(HttpApplication.name);
	constructor(
		private readonly projectRouter: IProjectRouter,
		private readonly access: IAccessService,
		private readonly now: () => number = () => performance.now(),
	) {}
	create(extensions: IHttpRouter[] = []): Koa {
		const app = new Koa();
		app.use(async (ctx, next) => {
			const started = this.now();
			let failure: unknown;
			try {
				await next();
			} catch (err) {
				failure = err;
				const badBody = err instanceof Error && "status" in err && err.status === 400;
				const tooLarge = err instanceof Error && "status" in err && err.status === 413;
				if (err instanceof AccessDeniedError) {
					ctx.status = 403;
					ctx.body = { error: "access-denied" };
				} else if (err instanceof InvalidProjectError || badBody || tooLarge) {
					ctx.status = tooLarge ? 413 : 400;
					ctx.body = { error: "invalid-request" };
				} else if (err instanceof ProjectNotFoundError) {
					ctx.status = 404;
					ctx.body = { error: "project-not-found" };
				} else if (err instanceof ProjectUnavailableError) {
					ctx.status = 503;
					ctx.body = { error: "project-unavailable" };
				} else {
					ctx.status = 500;
					ctx.body = { error: "internal-error" };
				}
			} finally {
				if (ctx.path !== "/health" || ctx.status >= 400) {
					this.log[ctx.status >= 500 ? "error" : ctx.status >= 400 ? "warn" : "info"](
						{
							err: failure,
							method: ctx.method,
							path: ctx.path,
							status: ctx.status,
							durationMs: Math.round(this.now() - started),
						},
						"Request completed",
					);
				}
			}
		});
		app.use(async (ctx, next) => {
			ctx.set("cache-control", "no-store");
			ctx.set("x-content-type-options", "nosniff");
			if (ctx.path === "/health" && ctx.method === "GET") {
				ctx.body = { status: "up" };
				return;
			}
			ctx.state["actor"] = this.access.authorize(
				ctx.headers["x-webauth-user"],
				ctx.headers["origin"],
				!["GET", "HEAD", "OPTIONS"].includes(ctx.method),
			);
			await next();
		});
		app.use(bodyParser({ enableTypes: ["json"], jsonLimit: "16kb" }));
		const router = this.projectRouter.create();
		app.use(router.routes()).use(router.allowedMethods());
		for (const extension of extensions) {
			const routes = extension.create();
			app.use(routes.routes()).use(routes.allowedMethods());
		}
		return app;
	}
}
