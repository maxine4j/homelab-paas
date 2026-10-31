import type { UiGitRefresh } from "@homelab-paas/shared-contracts";
import { bodyParser } from "@koa/bodyparser";
import Router from "@koa/router";
import { z } from "zod";

import { ConfigEditError } from "../config/paas-config.ts";
import { SecretEditError } from "../config/secret-store.ts";
import type { IServiceSecrets } from "../config/service-secrets.ts";
import { GitRefreshError, type IGitRefreshService } from "../git/git-refresh-service.ts";
import type { AuthedUserDetails } from "../ingress/auth/types.ts";
import { RedeployError, type IServiceRedeployer } from "../reconciler/reconciler-service.ts";
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
	gitRefresh: IGitRefreshService,
	sessions?: UiSessionVerifier,
	managementOrigin?: () => string,
	redeploy?: IServiceRedeployer,
	secrets?: IServiceSecrets,
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
					: error instanceof SecretEditError
						? error.kind === "invalid"
							? 400
							: error.kind === "conflict"
								? 409
								: error.kind === "not-found"
									? 404
									: 503
						: error instanceof ConfigEditError
							? error.kind === "invalid"
								? 400
								: error.kind === "conflict"
									? 409
									: 503
							: (error instanceof PaasUiError
										|| error instanceof GitRefreshError
										|| error instanceof RedeployError)
								  && error.kind === "not-found"
								? 404
								: 503;
			context.body = {
				message:
					error instanceof UiRequestError
					|| error instanceof PaasUiError
					|| error instanceof ConfigEditError
					|| error instanceof GitRefreshError
					|| error instanceof RedeployError
					|| error instanceof SecretEditError
						? error.message
						: "Cluster data is unavailable; retry shortly",
			};
		}
	});
	router.get("/services/:serviceId/secrets", async (context) => {
		if (!secrets) throw new SecretEditError("unavailable");
		context.body = await secrets.read(context.params["serviceId"]!);
	});
	router.put(
		"/services/:serviceId/secrets",
		async (context, next) => {
			if (
				context.get("origin") !== (managementOrigin?.() ?? `${context.protocol}://${context.host}`)
				|| context.get("x-paas-secrets") !== "1"
			) {
				context.status = 403;
				context.body = { message: "Secret edits require a same-origin request" };
				return;
			}
			if (!context.is("application/json")) {
				context.status = 415;
				context.body = { message: "Secret edits require JSON" };
				return;
			}
			await next();
		},
		bodyParser({
			enableTypes: ["json"],
			jsonLimit: "64kb",
			onError(error) {
				throw new UiRequestError("status" in error && error.status === 413 ? 413 : 400);
			},
		}),
		async (context) => {
			const result = z
				.strictObject({
					revision: z.string().min(1).max(256),
					changes: z
						.array(
							z.strictObject({
								name: z
									.string()
									.regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
									.refine((name) => !name.startsWith("PAAS_")),
								value: z.string().max(16384),
							}),
						)
						.min(1)
						.max(256),
				})
				.safeParse(context.request.body);
			if (!result.success) throw new SecretEditError("invalid");
			if (!secrets) throw new SecretEditError("unavailable");
			context.body = await secrets.update(context.params["serviceId"]!, result.data);
		},
	);
	router.post("/services/:serviceId/redeploy", async (context) => {
		if (
			context.get("origin") !== (managementOrigin?.() ?? `${context.protocol}://${context.host}`)
			|| context.get("x-paas-redeploy") !== "1"
		) {
			context.status = 403;
			context.body = { message: "Redeploy requires a same-origin request" };
			return;
		}
		if (!redeploy) throw new RedeployError("unavailable");
		await redeploy.redeploy(context.params["serviceId"]!);
		context.status = 204;
	});
	for (const path of ["/services/refresh", "/services/:serviceId/refresh"]) {
		router.post(path, async (context) => {
			if (
				context.get("origin") !== (managementOrigin?.() ?? `${context.protocol}://${context.host}`)
				|| context.get("x-paas-refresh") !== "1"
			) {
				context.status = 403;
				context.body = { message: "Git refresh requires a same-origin request" };
				return;
			}
			const serviceId = context.params["serviceId"];
			if (serviceId) {
				await gitRefresh.refreshOne(serviceId);
				context.body = { results: [{ serviceId, refreshed: true }] } satisfies UiGitRefresh;
			} else {
				context.body = { results: await gitRefresh.refreshAll() } satisfies UiGitRefresh;
			}
		});
	}
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
