import { expect, test, vi } from "vitest";

import { parseSecretEnv } from "./secret-env.ts";
import { SecretStore } from "./secret-store.ts";

const fixture = (initial: string | undefined = "OTHER='retained'\nTOKEN=old\n") => {
	let content = initial;
	const write = vi.fn(async (_path: string, value: string | Uint8Array) => {
		content = String(value);
	});
	const read = vi.fn(async () => content);
	return { store: new SecretStore("/env", read, write), write, read, content: () => content };
};

test("merges edits atomically and removes empty submissions while retaining other values", async () => {
	const f = fixture();
	const current = await f.store.read("demo");
	const next = await f.store.update("demo", current.revision, [
		{ name: "TOKEN", value: "new# $\\value" },
		{ name: "EMPTY", value: "" },
	]);
	expect(next.revision).not.toBe(current.revision);
	expect(parseSecretEnv(f.content()!)).toEqual(
		new Map([
			["OTHER", "retained"],
			["TOKEN", "new# $\\value"],
		]),
	);
	expect(f.write).toHaveBeenCalledWith("/env/demo.env", expect.any(String), { mode: 0o600 });
});

test("deletes existing declared and unused entries without changing unrelated empty assignments", async () => {
	const f = fixture("TOKEN=old\nEXTRA=unused\nEMPTY=\nOTHER=retained\n");
	const current = await f.store.read("demo");
	await f.store.update("demo", current.revision, [
		{ name: "TOKEN", value: "" },
		{ name: "EXTRA", value: "" },
	]);
	expect(parseSecretEnv(f.content()!)).toEqual(
		new Map([
			["EMPTY", ""],
			["OTHER", "retained"],
		]),
	);
});

test("serializes competing writers and rejects stale revisions", async () => {
	const f = fixture(undefined);
	const { revision } = await f.store.read("demo");
	const results = await Promise.allSettled([
		f.store.update("demo", revision, [{ name: "A", value: "first" }]),
		f.store.update("demo", revision, [{ name: "B", value: "second" }]),
	]);
	expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
	expect(results.at(1)).toMatchObject({ reason: { kind: "conflict" } });
	expect(f.write).toHaveBeenCalledTimes(1);
});

test("invalid identity, duplicate names, unrepresentable values and malformed existing files never write", async () => {
	const f = fixture();
	await expect(f.store.read("../bad")).rejects.toMatchObject({ kind: "not-found" });
	expect(f.read).not.toHaveBeenCalled();
	const { revision } = await f.store.read("demo");
	for (const changes of [
		[{ name: "A", value: "x\ny" }],
		[{ name: "bad-name", value: "x" }],
		[{ name: "PAAS_RESERVED", value: "x" }],
		[{ name: "A", value: "x".repeat(16385) }],
		[
			{ name: "A", value: "x" },
			{ name: "A", value: "y" },
		],
	])
		await expect(f.store.update("demo", revision, changes)).rejects.toMatchObject({ kind: "invalid" });
	const broken = fixture("TOKEN='private-value");
	await expect(broken.store.read("demo")).rejects.toThrow("Secrets are unavailable");
	expect(f.write).not.toHaveBeenCalled();
	expect(broken.write).not.toHaveBeenCalled();
});

test("infrastructure failures keep safe messages and preserve diagnostic causes for operator logs", async () => {
	const store = new SecretStore(
		"/env",
		async () => {
			throw new Error("secret-canary");
		},
		async () => {},
	);
	try {
		await store.read("demo");
	} catch (error) {
		expect(error).toHaveProperty("cause");
		expect(String(error)).not.toContain("secret-canary");
	}
});
