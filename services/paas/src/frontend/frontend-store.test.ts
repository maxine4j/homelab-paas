import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import { DirectoryUiFiles } from "./frontend-store.ts";

test("UI file contents stay cached for the lifetime of the adapter", async () => {
	const directory = await mkdtemp(join(tmpdir(), "paas-cache-"));
	try {
		const files = new DirectoryUiFiles(directory);
		await writeFile(join(directory, "index.html"), "first");
		expect(Buffer.from(await files.read("index.html")).toString()).toBe("first");
		await writeFile(join(directory, "index.html"), "second");
		expect(Buffer.from(await files.read("index.html")).toString()).toBe("first");
		expect(Buffer.from(await new DirectoryUiFiles(directory).read("index.html")).toString()).toBe("second");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
