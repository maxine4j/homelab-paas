import Router from "@koa/router";
import type { Context } from "koa";

export const createHealthCheckRouter = (options = { ready: true, version: "dev" }) => {
	const getHealth = (ctx: Context) => {
		ctx.status = options.ready ? 200 : 503;
		ctx.body = {
			status: "up",
		};
	};

	return new Router()
		.get("/health", getHealth)
		.get("/version", (ctx) => {
			ctx.body = { version: options.version };
		})
		.get("/identity", (ctx) => {
			ctx.body = {
				user: ctx.get("x-webauth-user"),
				email: ctx.get("x-webauth-email"),
				name: ctx.get("x-webauth-fullname"),
			};
		})
		.get("/inspect", (ctx) => {
			ctx.body = { version: options.version, cookie: ctx.get("cookie") };
		});
};
