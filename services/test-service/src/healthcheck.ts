import Router from "@koa/router";
import type { Context } from "koa";

export const createHealthCheckRouter = () => {
	const getHealth = (ctx: Context) => {
		ctx.status = 200;
		ctx.body = {
			status: "up",
		};
	};

	return new Router().get("/health", getHealth);
};
