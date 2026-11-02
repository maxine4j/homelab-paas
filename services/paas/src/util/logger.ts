import { createLogger } from "@homelab-paas/backend-infrastructure/logger";
import type { Middleware } from "koa";
import type { Logger } from "pino";

import type { AuthorizationLogFields } from "./types.ts";

export { logger, createLogger, withLogContext } from "@homelab-paas/backend-infrastructure/logger";

/** Successful authorization checks use DEBUG below 250ms; successful health checks stay silent. */
export const createRequestLogger =
	(log: Logger = createLogger("http"), now: () => number = () => performance.now()): Middleware =>
	async (ctx, next) => {
		const started = now();
		let failureStatus: number | undefined;
		let failure: unknown;
		try {
			await next();
		} catch (error) {
			failure = error;
			failureStatus =
				error instanceof Error
				&& "status" in error
				&& typeof error.status === "number"
				&& Number.isInteger(error.status)
				&& error.status >= 400
				&& error.status <= 599
					? error.status
					: 500;
			throw error;
		} finally {
			const status = failureStatus ?? ctx.status;
			const duration = now() - started;
			const authorization = /^\/auth\/check(?:\/|$)/.test(ctx.path);
			const fields: AuthorizationLogFields | undefined = authorization ? ctx.state["authorization"] : undefined;
			if (ctx.path !== "/health" || status >= 400) {
				const level =
					status >= 500
						? "error"
						: status >= 400
							? "warn"
							: authorization && status >= 200 && status < 300 && duration < 250
								? "debug"
								: "info";
				log[level](
					{
						...fields,
						err: failure,
						method: ctx.method,
						path: ctx.path,
						status,
						durationMs: Math.round(duration),
					},
					"Request completed",
				);
			}
		}
	};
