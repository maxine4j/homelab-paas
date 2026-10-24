import { expect, test } from "vitest";

import { logFatalError } from "./fatal-error.ts";
import { createLogger } from "./logger.ts";

test.each(["unhandledRejection", "uncaughtException"] as const)("%s logs the complete error and cause", (event) => {
	const lines: string[] = [];
	const log = createLogger("process", { write: (line: string) => lines.push(line) });
	const cause = Object.assign(new Error("Connection refused"), {
		code: "ECONNREFUSED",
		address: "db",
	});
	const failure = Object.assign(new TypeError("Startup failed", { cause }), { detail: "diagnostic context" });
	logFatalError(event, failure, log);

	expect(JSON.parse(lines.at(0)!)).toMatchObject({
		level: 50,
		operation: "fatal",
		msg: `Fatal process failure: ${event}`,
		failure: {
			type: "TypeError",
			message: failure.message,
			stack: failure.stack,
			detail: "diagnostic context",
			cause: { type: "Error", message: cause.message, stack: cause.stack, code: "ECONNREFUSED", address: "db" },
		},
	});
});

test.each(["rejection detail", { detail: "rejection detail" }, null, 42])(
	"non-Error rejections retain the original value: %j",
	(reason) => {
		const lines: string[] = [];
		const log = createLogger("process", { write: (line: string) => lines.push(line) });
		logFatalError("unhandledRejection", reason, log);
		expect(JSON.parse(lines.at(0)!)).toMatchObject({ failure: reason });
	},
);
