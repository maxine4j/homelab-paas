import { bodyParser } from "@koa/bodyparser";
import Router from "@koa/router";
import { z } from "zod";

import { ConfigEditError } from "../config/paas-config.ts";
import type { AuthedUserDetails } from "../ingress/auth/types.ts";
import { logger } from "../util/logger.ts";
import { PaasUiError, type IPaasUiService } from "./paas-ui-service.ts";

export interface UiSessionVerifier {
	verifyAuthCookie(token: string | undefined): AuthedUserDetails | undefined;
}

class UiRequestError extends Error {
	constructor(
		readonly status: 400 | 413,
		options?: ErrorOptions,
	) {
		super("Invalid configuration request", options);
	}
}

/** Management API; configured sessions are verified even behind Envoy. */
export const createPaasUiRouter = (
	service: IPaasUiService,
	sessions?: UiSessionVerifier,
	managementOrigin?: () => string,
): Router => {
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
			context.status =
				error instanceof UiRequestError
					? error.status
					: error instanceof ConfigEditError
						? error.kind === "invalid"
							? 400
							: error.kind === "conflict"
								? 409
								: 503
						: error instanceof PaasUiError && error.kind === "not-found"
							? 404
							: 503;
			context.body = {
				message:
					error instanceof UiRequestError || error instanceof PaasUiError || error instanceof ConfigEditError
						? error.message
						: "Cluster data is unavailable; retry shortly",
			};
		}
	});
	router.get("/cluster", async (context) => {
		context.body = await service.getCluster();
	});
	router.get("/services/:serviceId/events", async (context) => {
		context.body = await service.getEvents(context.params["serviceId"]!);
	});
	router.put(
		"/cluster/config",
		async (context, next) => {
			if (
				context.get("origin") !== (managementOrigin?.() ?? `${context.protocol}://${context.host}`)
				|| context.get("x-paas-config") !== "1"
			) {
				context.status = 403;
				context.body = { message: "Configuration edits require a same-origin request" };
				return;
			}
			if (!context.is("application/json")) {
				context.status = 415;
				context.body = { message: "Configuration edits require JSON" };
				return;
			}
			await next();
		},
		bodyParser({
			enableTypes: ["json"],
			jsonLimit: "64kb",
			onError(error) {
				throw new UiRequestError("status" in error && error.status === 413 ? 413 : 400, { cause: error });
			},
		}),
		async (context) => {
			const result = z
				.strictObject({
					revision: z.string().min(1).max(128),
					changes: z
						.array(z.strictObject({ path: z.string().min(1).max(128), value: z.json() }))
						.min(1)
						.max(128),
				})
				.safeParse(context.request.body);
			if (!result.success) {
				context.status = 400;
				context.body = { message: "Invalid configuration request" };
				return;
			}
			context.body = await service.updateConfig(result.data);
		},
	);
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
