import { expect, test } from "vitest";

import { presentLog } from "./structured-log.ts";

test("uses valid application timestamps first and Docker timestamps as fallback", () => {
	const prefix = "2026-11-05T01:02:03.123456789Z";
	expect(presentLog(`${prefix} {"timestamp":0}`)?.time?.getTime()).toBe(0);
	expect(presentLog(`${prefix} {"time":"invalid"}`)?.time?.toISOString()).toBe("2026-11-05T01:02:03.123Z");
	expect(presentLog('{"time":"invalid"}')?.time).toBeUndefined();
	expect(presentLog('{"time":"invalid"}')?.context).toEqual({ time: "invalid" });
});

test("supports severity aliases, numeric Pino levels and neutral unknown levels", () => {
	for (const [input, expected] of [
		[10, "debug"],
		[20, "debug"],
		[30, "info"],
		[40, "warn"],
		[50, "error"],
		[60, "error"],
		["WARNING", "warn"],
		["fatal", "error"],
		["trace", "debug"],
		["other", "unknown"],
	]) {
		expect(presentLog(JSON.stringify({ severity: input }))?.level).toBe(expected);
	}
});

test("formats full structured causes including non-Error rejection values without duplicating Pino stacks", () => {
	const entry = presentLog(
		JSON.stringify({
			failure: {
				message: "Outer",
				stack: "Error: Outer\n    at outer (a.ts:1:1)\ncaused by: Error: Inner\n    at inner (b.ts:1:1)",
				cause: {
					message: "Inner",
					stack: "Error: Inner\n    at inner (b.ts:1:1)",
					cause: "Connection refused",
				},
			},
		}),
	);
	expect(entry?.message).toBe("Outer");
	expect(entry?.stack.match(/Error: Inner/g)).toHaveLength(1);
	expect(entry?.stack).toContain("Caused by:\nConnection refused");
});

test("keeps raw bytes and all context and rejects non-object JSON", () => {
	const raw = ' { "msg": "hello", "requestId": 7, "err": {"message":"failed"} } ';
	expect(presentLog(raw)?.raw).toBe(raw);
	expect(presentLog(raw)?.context).toEqual({ requestId: 7, err: { message: "failed" } });
	for (const line of ["null", "[]", "12", '"text"', "{broken", "plain"]) expect(presentLog(line)).toBeUndefined();
});

test("retains nonstandard cause objects and related errors without stacks", () => {
	const entry = presentLog(
		JSON.stringify({
			error: { message: "Failed", cause: { code: "ECONNREFUSED" }, errors: [{ message: "Related failure" }] },
		}),
	);
	expect(entry?.stack).toContain('Caused by:\n{\n  "code": "ECONNREFUSED"\n}');
	expect(entry?.stack).toContain("Related failure");
});
