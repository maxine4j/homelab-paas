import Router from "@koa/router";

import type { AuthedUserDetails } from "../ingress/auth/types.ts";
import { logger } from "../util/logger.ts";
import { PaasUiError, type IPaasUiService } from "./paas-ui-service.ts";

export interface UiSessionVerifier {
	verifyAuthCookie(token: string | undefined): AuthedUserDetails | undefined;
}

/** Read-only management API; configured sessions are verified even behind Envoy. */
export const createPaasUiRouter = (service: IPaasUiService, sessions?: UiSessionVerifier): Router => {
	const router = new Router({ prefix: "/api/ui" });
	router.use(async (context, next) => {
		context.set("cache-control", "no-store");
		try {
			const cookies = context
				.get("cookie")
				.split(";")
				.map((part) => part.trim())
				.filter((part) => part.startsWith("__Secure-paas_session="));
			const token = cookies.length === 1 ? context.cookies.get("__Secure-paas_session") : undefined;
			if (sessions && !sessions.verifyAuthCookie(token)) {
				context.status = 401;
				context.body = { message: "A platform session is required" };
				return;
			}
			await next();
		} catch (error) {
			logger.error({ err: error }, "Management API request failed");
			context.status = error instanceof PaasUiError && error.kind === "not-found" ? 404 : 503;
			context.body = {
				message: error instanceof PaasUiError ? error.message : "Cluster data is unavailable; retry shortly",
			};
		}
	});
	router.get("/cluster", async (context) => {
		context.body = await service.getCluster();
	});
	router.get("/services", async (context) => {
		context.body = await service.listServices();
	});
	router.get("/services/:serviceId", async (context) => {
		context.body = await service.getService(context.params["serviceId"]!);
	});
	router.get("/services/:serviceId/resources/:resourceId", async (context) => {
		context.body = await service.getResource(context.params["serviceId"]!, context.params["resourceId"]!);
	});
	router.get("/services/:serviceId/resources/:resourceId/containers/:containerId/logs", async (context) => {
		context.body = await service.getLogs(
			context.params["serviceId"]!,
			context.params["resourceId"]!,
			context.params["containerId"]!,
		);
	});
	return router;
};
