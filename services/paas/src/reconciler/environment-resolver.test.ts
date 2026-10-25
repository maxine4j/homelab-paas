import { expect, test, vi } from "vitest";

import { EnvironmentResolver } from "./environment-resolver.ts";

test("reads the service file anew and selects only declared secrets alongside literals", async () => {
	const read = vi.fn(async () => "# comment\nTOKEN = 'first=token'\nEMPTY=\nUNUSED=hidden\n");
	const resolver = new EnvironmentResolver("/etc/homelab-paas/env", read);
	const env = [
		{ name: "TOKEN", secret: true as const },
		{ name: "EMPTY", secret: true as const },
		{ name: "PLAIN", value: "literal" },
	];
	expect(await resolver.resolve("example-service-id", env)).toEqual([
		{ name: "TOKEN", value: "first=token" },
		{ name: "EMPTY", value: "" },
		{ name: "PLAIN", value: "literal" },
	]);
	expect(read).toHaveBeenCalledWith("/etc/homelab-paas/env/example-service-id.env");
	read.mockResolvedValue('TOKEN="second token" # comment\nEMPTY=\n');
	expect((await resolver.resolve("example-service-id", env)).at(0)).toEqual({ name: "TOKEN", value: "second token" });
	expect(read).toHaveBeenCalledTimes(2);
});

test("literal-only workloads require no secret file", async () => {
	const read = vi.fn(async () => undefined);
	expect(await new EnvironmentResolver("/env", read).resolve("demo", [{ name: "FOO", value: "bar" }])).toEqual([
		{ name: "FOO", value: "bar" },
	]);
	expect(read).not.toHaveBeenCalled();
});

test.each([
	undefined,
	"OTHER=value",
	"TOKEN='unterminated",
	"TOKEN=one\nTOKEN=two",
	"invalid SECRET",
	"TOKEN=bad\0value",
	'TOKEN="value" trailing',
])("fails closed on missing or invalid secrets without leaking content: %j", async (content) => {
	const resolver = new EnvironmentResolver("/env", async () => content);
	await expect(resolver.resolve("demo", [{ name: "TOKEN", secret: true }])).rejects.toThrow(
		"Cannot resolve application secrets; check the service env file and required variable names",
	);
});

test("sanitizes file access errors and rejects service path traversal", async () => {
	const read = vi.fn(async () => {
		throw new Error("SECRET /sensitive/path");
	});
	const resolver = new EnvironmentResolver("/env", read);
	await expect(resolver.resolve("demo", [{ name: "TOKEN", secret: true }])).rejects.toThrow(
		"Cannot resolve application secrets; check the service env file and required variable names",
	);
	read.mockClear();
	await expect(resolver.resolve("../other", [{ name: "TOKEN", secret: true }])).rejects.toThrow(
		"Cannot resolve application secrets",
	);
	expect(read).not.toHaveBeenCalled();
});

test("reports every missing secret name and actual host file without exposing configured values", async () => {
	const resolver = new EnvironmentResolver("/etc/homelab-paas/env", async () => "PRESENT=private-value\n", {
		resolve: async () => "/srv/paas/config/env/demo.env",
	});
	await expect(
		resolver.resolve("demo", [
			{ name: "FIRST", secret: true },
			{ name: "PRESENT", secret: true },
			{ name: "SECOND", secret: true },
			{ name: "LITERAL", value: "private-literal" },
		]),
	).rejects.toMatchObject({
		name: "EnvironmentResolutionError",
		details: {
			reason: "missing-variables",
			filePath: "/etc/homelab-paas/env/demo.env",
			hostFilePath: "/srv/paas/config/env/demo.env",
			missingVariables: ["FIRST", "SECOND"],
		},
		message: expect.stringContaining("FIRST, SECOND"),
	});
	try {
		await resolver.resolve("demo", [{ name: "TOKEN", secret: true }]);
	} catch (error) {
		expect((error as Error).message).not.toContain("private-value");
	}
});

test.each([
	[undefined, "missing-file", undefined],
	["TOKEN='private-value", "invalid-file", 1],
	["# comment\nTOKEN=value\nTOKEN=private-value", "invalid-file", 3],
	["TOKEN=private-value\0", "invalid-file", undefined],
] as const)("reports safe file diagnostics: %s", async (content, reason, line) => {
	const resolver = new EnvironmentResolver("/env", async () => content);
	await expect(resolver.resolve("demo", [{ name: "TOKEN", secret: true }])).rejects.toMatchObject({
		details: { reason, filePath: "/env/demo.env", ...(line ? { line } : {}) },
	});
});

test("host lookup failure preserves the original file failure without guessing a host path", async () => {
	const cause = new Error("private access failure");
	const resolver = new EnvironmentResolver(
		"/env",
		async () => {
			throw cause;
		},
		{
			resolve: async () => {
				throw new Error("Docker unavailable");
			},
		},
	);
	try {
		await resolver.resolve("demo", [{ name: "TOKEN", secret: true }]);
		throw new Error("expected failure");
	} catch (error) {
		expect(error).toMatchObject({ cause, details: { reason: "unreadable-file", filePath: "/env/demo.env" } });
		expect((error as { details: object }).details).not.toHaveProperty("hostFilePath");
		expect((error as Error).message).not.toContain("private access failure");
	}
});
