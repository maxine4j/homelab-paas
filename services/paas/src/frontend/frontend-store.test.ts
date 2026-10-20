import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import { mkdtemp, writeFile, rm, lstat, readFileBytes, symlink } from "../util/file.ts";
import { DirectoryUiFiles } from "./frontend-store.ts";

test("keeps assets binary and blocks symbolic links and traversal", async () => {
	const directory = await mkdtemp(join(tmpdir(), "paas-ui-"));
	try {
		const bytes = Uint8Array.from([0, 255, 128, 1]);
		await writeFile(join(directory, "asset.bin"), bytes);
		await symlink(join(directory, "asset.bin"), join(directory, "link.bin"));
		const files = new DirectoryUiFiles(directory, lstat, readFileBytes);
		expect(await files.read("asset.bin")).toEqual(Buffer.from(bytes));
		expect(await files.inspect("link.bin")).toBe("blocked");
		expect(await files.inspect("../asset.bin")).toBe("blocked");
		await expect(files.read("link.bin")).rejects.toThrow();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("UI file contents stay cached for the lifetime of the adapter", async () => {
	const directory = await mkdtemp(join(tmpdir(), "paas-cache-"));
	try {
		const files = new DirectoryUiFiles(directory, lstat, readFileBytes);
		await writeFile(join(directory, "index.html"), "first");
		expect(Buffer.from(await files.read("index.html")).toString()).toBe("first");
		await writeFile(join(directory, "index.html"), "second");
		expect(Buffer.from(await files.read("index.html")).toString()).toBe("first");
		expect(
			Buffer.from(await new DirectoryUiFiles(directory, lstat, readFileBytes).read("index.html")).toString(),
		).toBe("second");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
