import { expect, test } from "vitest";

import { logFatalError } from "./fatal-error.ts";
import { createLogger } from "./logger.ts";

test("fatal diagnostics include error type, system code, stack locations and causes without raw payloads", () => {
	const lines: string[] = [];
	const log = createLogger("process", { write: (line: string) => lines.push(line) });
	const cause = Object.assign(new Error("connect postgres://user:SECRET@db"), {
		code: "ECONNREFUSED",
		command: "SECRET",
	});
	const failure = new TypeError("SECRET", { cause });
	logFatalError("unhandledRejection", failure, log);

	expect(lines.join("")).not.toContain("SECRET");
	expect(JSON.parse(lines.at(0)!)).toMatchObject({
		level: 50,
		operation: "fatal",
		msg: "Fatal process failure: unhandledRejection",
		failure: {
			type: "TypeError",
			frames: expect.arrayContaining([expect.stringMatching(/^fatal-error\.test\.ts:\d+:\d+$/)]),
			cause: { type: "Error", code: "ECONNREFUSED" },
		},
	});
});

test.each(["SECRET", { token: "SECRET" }, null, undefined, 42])(
	"non-Error rejections report their value type without serializing the value: %j",
	(reason) => {
		const lines: string[] = [];
		const log = createLogger("process", { write: (line: string) => lines.push(line) });
		logFatalError("unhandledRejection", reason, log);
		expect(lines.join("")).not.toContain("SECRET");
		expect(JSON.parse(lines.at(0)!)).toMatchObject({ failure: { type: reason === null ? "null" : typeof reason } });
	},
);

test("diagnostics omit arbitrary error names, codes, stack text and URL credentials", () => {
	const lines: string[] = [];
	const log = createLogger("process", { write: (line: string) => lines.push(line) });
	const failure = Object.assign(new Error("SECRET"), { name: "SECRET", code: "SECRET" });
	failure.stack =
		"SECRET\n    at SECRET (file:///app/src/start.ts:10:20)\nSECRET\n    at https://user:SECRET@host/run.js?token=SECRET:1:2";
	logFatalError("uncaughtException", failure, log);
	expect(lines.join("")).not.toContain("SECRET");
	expect(JSON.parse(lines.at(0)!)).toMatchObject({ failure: { type: "Error", frames: ["start.ts:10:20"] } });
});

test("cyclic causes and deep chains produce bounded diagnostics", () => {
	const lines: string[] = [];
	const log = createLogger("process", { write: (line: string) => lines.push(line) });
	const failure = new Error("SECRET");
	failure.cause = failure;
	logFatalError("unhandledRejection", failure, log);
	let deep = new Error("SECRET");
	for (let index = 0; index < 100; index++) deep = new Error("SECRET", { cause: deep });
	logFatalError("uncaughtException", deep, log);
	expect(lines.join("")).not.toContain("SECRET");
	expect(JSON.parse(lines.at(0)!)).toMatchObject({ failure: { cause: { type: "truncated" } } });
	let diagnostic = JSON.parse(lines.at(1)!).failure;
	for (let index = 0; index < 5; index++) diagnostic = diagnostic.cause;
	expect(diagnostic).toEqual({ type: "truncated" });
});
