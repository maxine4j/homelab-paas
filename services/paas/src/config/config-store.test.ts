import { expect, test, vi } from "vitest";

import { parseYaml } from "../util/yaml.ts";
import { FileConfigStore } from "./config-store.ts";

test("configuration storage parses YAML and writes restricted documents with stable content revisions", async () => {
	let disk = "version: 1\n";
	const write = vi.fn(async (_path: string, data: string | Uint8Array) => {
		disk = String(data);
	});
	const store = new FileConfigStore(async () => disk, write);
	const initial = await store.read();
	expect(initial.value).toEqual({ version: 1 });
	expect(await store.read()).toEqual(initial);
	const saved = await store.write({ version: 2 });
	expect(parseYaml(disk, "saved config")).toEqual({ version: 2 });
	expect(write).toHaveBeenCalledWith("/etc/homelab-paas/config.yaml", disk, { mode: 0o600 });
	expect(saved).toEqual(await store.read());
	expect(saved.revision).not.toBe(initial.revision);
});

test("configuration storage sanitizes missing, malformed and failed reads and writes", async () => {
	for (const content of [undefined, "invalid: [private-secret"]) {
		await expect(new FileConfigStore(async () => content, vi.fn()).read()).rejects.toThrow(
			"Cannot load platform configuration",
		);
	}
	const failure = new Error("private-secret");
	const fail = async () => {
		throw failure;
	};
	await expect(new FileConfigStore(fail, fail).read()).rejects.toMatchObject({
		cause: failure,
		message:
			"Cannot load platform configuration; check /etc/homelab-paas/config.yaml against the platform configuration contract",
	});
	await expect(new FileConfigStore(fail, fail).write({})).rejects.toMatchObject({
		cause: failure,
		message: "Cannot save platform configuration",
	});
});
