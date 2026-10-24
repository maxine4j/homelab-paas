import { constants } from "node:os";

import type { Logger } from "pino";

import { logger } from "./logger.ts";

interface FailureDiagnostic {
	type: string;
	code?: string;
	frames?: string[];
	cause?: FailureDiagnostic;
}

const systemCodes = new Set(Object.keys(constants.errno));
const errorTypes = [EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError, AggregateError];

/** Serialize only diagnostic metadata; messages and arbitrary properties may contain secrets. */
const describeFailure = (reason: unknown, seen = new Set<Error>()): FailureDiagnostic => {
	if (!(reason instanceof Error)) return { type: reason === null ? "null" : typeof reason };
	if (seen.has(reason) || seen.size >= 5) return { type: "truncated" };
	seen.add(reason);
	const diagnostic: FailureDiagnostic = {
		type: errorTypes.find((type) => reason instanceof type)?.name ?? "Error",
		frames: (reason.stack ?? "")
			.split("\n")
			.filter((line) => line.startsWith("    at "))
			.flatMap((line) => {
				// Keep only source basenames and coordinates, never messages, function names or URL data.
				const location = line.match(/(?:\/|^    at )([\w.-]+\.[cm]?[jt]s:\d+:\d+)\)?$/)?.at(1);
				return location ? [location] : [];
			})
			.slice(0, 20),
	};
	if ("code" in reason && typeof reason.code === "string" && systemCodes.has(reason.code))
		diagnostic.code = reason.code;
	if (reason.cause !== undefined) diagnostic.cause = describeFailure(reason.cause, seen);
	return diagnostic;
};

export const logFatalError = (
	event: "uncaughtException" | "unhandledRejection",
	reason: unknown,
	log: Logger = logger,
): void => {
	log.error({ operation: "fatal", failure: describeFailure(reason) }, `Fatal process failure: ${event}`);
};
