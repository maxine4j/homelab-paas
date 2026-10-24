import type { Logger } from "pino";

import { logger } from "./logger.ts";

export const logFatalError = (
	event: "uncaughtException" | "unhandledRejection",
	reason: unknown,
	log: Logger = logger,
): void => {
	log.error({ operation: "fatal", failure: reason }, `Fatal process failure: ${event}`);
};
