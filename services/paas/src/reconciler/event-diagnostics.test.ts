import { expect, test } from "vitest";

import { testConfig } from "../util/test/config.ts";
import { EnvironmentResolutionError } from "./environment-resolver.ts";
import { EventDiagnostics } from "./event-diagnostics.ts";

test("captures error chains, stacks and provider properties with redacted deployment context", () => {
	const provider = Object.assign(new Error("Docker POST /containers/create: HTTP 500: bind failed private-value"), {
		code: "EACCES",
		command: ["run", "private-argument"],
		cmd: "git --token private-cmd",
		args: ["private-args"],
		api_key: "private-api-key",
		password: "private-password",
	});
	const error = new Error("Cannot deploy https://user:pass@registry/app", { cause: provider });
	const text = new EventDiagnostics(testConfig()).describe(error, { operation: "web", image: "app:1" }, [
		"private-value",
	]);
	expect(text).toContain("Docker POST /containers/create: HTTP 500: bind failed [redacted]");
	expect(text).toContain("EACCES");
	expect(text).toContain("stack");
	expect(text).toContain('"operation": "web"');
	expect(text).toContain('"image": "app:1"');
	for (const value of [
		"private-value",
		"private-argument",
		"private-password",
		"user:pass",
		"private-cmd",
		"private-args",
		"private-api-key",
	])
		expect(text).not.toContain(value);
});

test("bounds cyclic, large and non-Error failures with explicit omission markers", () => {
	const diagnostics = new EventDiagnostics(testConfig());
	const cyclic: Record<string, unknown> = { code: "BROKEN" };
	cyclic["cause"] = cyclic;
	expect(diagnostics.describe(cyclic, {}, [])).toContain("[circular]");
	expect(diagnostics.describe("plain rejection", {}, [])).toContain("plain rejection");
	const text = diagnostics.describe(new Error("x".repeat(100000)), {}, []);
	expect(Buffer.byteLength(JSON.stringify(text))).toBeLessThanOrEqual(32768);
	expect(text).toContain("[truncated]");
});

test("retains aggregate failures, typed provider data and redacts secret values in keys", () => {
	const error = new AggregateError(
		[
			Object.assign(new Error("start failed"), {
				status: 500,
				retryable: false,
				body: { message: "bind source unavailable" },
			}),
			new Error("cleanup failed", { cause: new Error("Docker DELETE /containers/replacement: HTTP 409") }),
		],
		"Startup and cleanup failed",
	);
	const text = new EventDiagnostics(testConfig()).describe(error, { "private-value": "context" }, ["private-value"]);
	expect(text).toContain("start failed");
	expect(text).toContain("cleanup failed");
	expect(text).toContain("Docker DELETE /containers/replacement: HTTP 409");
	expect(text).toContain('"status": 500');
	expect(text).toContain('"retryable": false');
	expect(text).toContain("bind source unavailable");
	expect(text).not.toContain("private-value");
});

test("secret-file failures retain safe location and stack without returning unreadable file content", () => {
	const error = new EnvironmentResolutionError(
		{ reason: "unreadable-file", filePath: "/env/demo.env" },
		{
			cause: new Error("private-file-content"),
		},
	);
	const text = new EventDiagnostics(testConfig()).describe(error, { operation: "secrets" }, []);
	expect(text).toContain("/env/demo.env");
	expect(text).toContain("unreadable-file");
	expect(text).toContain("stack");
	expect(text).not.toContain("private-file-content");
});

test("redacts full original values before clipping long strings, including unicode and control characters", () => {
	const value = `${"雪\n".repeat(15000)}private-value${"x".repeat(20000)}`;
	const text = new EventDiagnostics(testConfig()).describe({ body: value }, {}, ["private-value"]);
	expect(Buffer.byteLength(JSON.stringify(text))).toBeLessThanOrEqual(32768);
	expect(text).toContain("[truncated]");
	expect(text).not.toContain("private-value");
});

test("preserves the failure before clipping unusually large deployment context", () => {
	const text = new EventDiagnostics(testConfig()).describe(
		new Error("specific-provider-failure"),
		{
			volumes: Array.from({ length: 32 }, () => ({ hostPath: "x".repeat(20000) })),
		},
		[],
	);
	expect(text).toContain("specific-provider-failure");
	expect(text).toContain("[truncated]");
});

test("masks echoed child-process commands while retaining their actionable stderr", () => {
	const error = new Error("Command failed: git clone --password private-inline\nfatal: repository access denied");
	const text = new EventDiagnostics(testConfig()).describe(error, {}, []);
	expect(text).toContain("repository access denied");
	expect(text).not.toContain("private-inline");
});
