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
