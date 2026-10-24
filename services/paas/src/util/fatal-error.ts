import pino, { type Logger } from "pino";

import { logger } from "./logger.ts";

export const logFatalError = (
	event: "uncaughtException" | "unhandledRejection",
	reason: unknown,
	log: Logger = logger,
): void => {
	log.error(
		{ operation: "fatal", failure: reason instanceof Error ? pino.stdSerializers.errWithCause(reason) : reason },
		`Fatal process failure: ${event}`,
	);
};
