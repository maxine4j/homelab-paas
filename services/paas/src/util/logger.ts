import { AsyncLocalStorage } from "node:async_hooks";

import type { Middleware } from "koa";
import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";

import type { AuthorizationLogFields } from "./types.ts";

const context = new AsyncLocalStorage<{ task: string; taskId: string }>();
const serializeError = (error: unknown): unknown =>
	error instanceof Error
		? { ...pino.stdSerializers.errWithCause(error), stack: pino.stdSerializers.err(error).stack }
		: error;
const options: LoggerOptions = {
	timestamp: pino.stdTimeFunctions.isoTime,
	mixin: () => ({ ...context.getStore() }),
	serializers: { err: serializeError, error: serializeError, failure: serializeError },
};

/** All application loggers share automatic async task context. */
export const logger = pino(options, process.stdout);

export const createLogger = (component: string, destination?: DestinationStream): Logger =>
	(destination ? pino(options, destination) : logger).child({ component });

/** Runners establish context once; nested log calls need no tracing arguments. */
export const withLogContext = <T>(fields: { task: string; taskId: string }, run: () => T): T =>
	context.run(fields, run);

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
