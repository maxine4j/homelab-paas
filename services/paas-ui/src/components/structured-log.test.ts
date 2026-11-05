import { expect, test } from "vitest";

import { presentLog } from "./structured-log.ts";

test("prefers Docker timestamps and retains the application timestamp in context", () => {
	const prefix = "2026-11-05T01:02:03.123456789Z";
	const entry = presentLog(prefix + ' {"timestamp":0}');
	expect(entry?.time?.toISOString()).toBe("2026-11-05T01:02:03.123Z");
	expect(entry?.context).toEqual({ timestamp: 0 });
	expect(presentLog('{"timestamp":0}')?.time?.getTime()).toBe(0);
	expect(presentLog('2026-11-05Tbogus {"msg":"plain"}')).toBeUndefined();
	expect(presentLog(`${prefix} {"time":"invalid"}`)?.time?.toISOString()).toBe("2026-11-05T01:02:03.123Z");
	expect(presentLog('{"time":"invalid"}')?.time).toBeUndefined();
	expect(presentLog('{"time":"invalid"}')?.context).toEqual({ time: "invalid" });
});

const dockerTime = "2026-11-05T05:00:40.362009452Z";
const wrapped = (line: string) => dockerTime + " " + line;

test("parses Docker-prefixed Pino and summarizes Envoy JSON access records", () => {
	const request = { method: "GET", path: "/api/projects", status: 200, time: "2026-11-05T05:00:40.361Z" };
	const pino = { ...request, level: 30, msg: "Request completed" };
	const envoy = { ...request, component: "ingress", upstreamCluster: "paas", durationMs: 1 };
	expect(presentLog(wrapped(JSON.stringify(pino)))).toMatchObject({
		message: "Request completed",
		level: "info",
		data: pino,
		time: new Date(dockerTime),
	});
	expect(presentLog(wrapped(JSON.stringify(envoy)))).toMatchObject({
		message: "GET /api/projects → 200",
		data: envoy,
		context: envoy,
		time: new Date(dockerTime),
	});
	expect(presentLog(JSON.stringify({ ...request, component: "custom" }))?.message).toBe("Structured log");
	expect(presentLog(JSON.stringify({ ...envoy, upstreamCluster: null, status: 404 }))?.message).toBe(
		"GET /api/projects → 404",
	);
});

test("parses complete key/value records with quoted values and escapes", () => {
	const line = String.raw`logger=dashboard-service t=2026-11-05T04:43:55.999Z level=error msg="Failed to clean \"dashboard\"" error="unable to open database file (14)" key="{Group:dashboard.grafana.app Resource:dashboards}"`;
	const raw = wrapped(line);
	expect(presentLog(raw)).toMatchObject({
		raw,
		level: "error",
		message: 'Failed to clean "dashboard"',
		time: new Date(dockerTime),
		context: {
			logger: "dashboard-service",
			t: "2026-11-05T04:43:55.999Z",
			error: "unable to open database file (14)",
			key: "{Group:dashboard.grafana.app Resource:dashboards}",
		},
	});
	expect(presentLog(line)?.time).toEqual(new Date("2026-11-05T04:43:55.999Z"));
	for (const invalid of ['level=info msg="unclosed', "level=info msg=hello extra text", "foo=bar"])
		expect(presentLog(invalid)).toBeUndefined();
});

test("parses tab-delimited severity and source without consuming tabs within messages", () => {
	const time = "2026-11-05T04:23:47.394Z";
	const source = "VictoriaMetrics/lib/fs/fs.go:88";
	const line = [time, "panic", source, "write failed:\tno space left on device"].join("\t");
	expect(presentLog(wrapped(line))).toMatchObject({
		message: "write failed:\tno space left on device",
		level: "error",
		context: { source, time },
		time: new Date(dockerTime),
	});
	expect(presentLog(line)?.time).toEqual(new Date(time));
	expect(presentLog(wrapped("panic: FATAL: no space left on device"))).toMatchObject({
		message: "FATAL: no space left on device",
		level: "error",
		time: new Date(dockerTime),
	});
	expect(presentLog(wrapped("\tsync/waitgroup.go:251 +0x45"))).toBeUndefined();
});

test("parses timestamped text with source or component level markers", () => {
	const forgejo = "2026/11/04 05:05:58 ...er/issues/indexer.go:80:func1() [I] Initializing Issue Indexer";
	const telegraf = "2026-11-05T05:05:08Z E! [outputs.loki] Error writing to outputs.loki";
	expect(presentLog(wrapped(forgejo))).toMatchObject({
		message: "Initializing Issue Indexer",
		level: "info",
		context: { source: "...er/issues/indexer.go:80:func1()", time: "2026/11/04 05:05:58" },
		time: new Date(dockerTime),
	});
	expect(presentLog(forgejo)?.time).toBeUndefined();
	expect(presentLog(wrapped(telegraf))).toMatchObject({
		message: "Error writing to outputs.loki",
		level: "error",
		context: { component: "outputs.loki", time: "2026-11-05T05:05:08Z" },
		time: new Date(dockerTime),
	});
	expect(presentLog(telegraf)?.time).toEqual(new Date("2026-11-05T05:05:08Z"));
});

test.each([
	"  --> GET /api/projects 200 835ms 746b",
	"  -x- GET /api/projects 200 835ms -",
	"GET /api/projects \u001b[32m200\u001b[0m 0.224 ms - 2",
	"GET /api/projects 200 2 - 0.188 ms",
	"::1 - GET /api/projects HTTP/1.1 200 2 - 0.283 ms",
	'::1 - - [27/Nov/2024:06:21:42 +0100] "GET /api/projects HTTP/1.1" 200 2',
	'::1 - - [27/Nov/2024:06:21:42 +0100] "GET /api/projects HTTP/1.1" 200 2 "-" "curl/8.7.1"',
])("summarizes completed HTTP access output: %s", (line) => {
	const raw = wrapped(line);
	expect(presentLog(raw)).toMatchObject({
		raw,
		message: "GET /api/projects → 200",
		context: { method: "GET", path: "/api/projects", status: 200 },
		time: new Date(dockerTime),
	});
});

test("uses common access timestamps without Docker and leaves incomplete requests plain", () => {
	const common = '::1 - - [27/Nov/2024:06:21:42 +0100] "GET / HTTP/1.1" 200 2';
	expect(presentLog(common)?.time).toEqual(new Date("2024-11-27T05:21:42Z"));
	for (const line of ["  <-- GET /", "GET / 200 unrelated text", "GET / - - ms - -", "stdout:"])
		expect(presentLog(wrapped(line))).toBeUndefined();
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
