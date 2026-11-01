import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import * as files from "../util/file.ts";
import { StaticStore } from "./static-store.ts";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => files.rm(root, { recursive: true, force: true })));
});
const fixture = async () => {
	const root = await files.mkdtemp(join(tmpdir(), "paas-static-"));
	roots.push(root);
	return { root, store: new StaticStore(root, files) };
};
const identity = { serviceId: "demo", resourceId: "site", revision: "a".repeat(40), path: "/dist" };
const bundle = [
	{ path: "index.html", content: new TextEncoder().encode("hello") },
	{ path: "assets/a.bin", content: new Uint8Array([0, 255]) },
];

test("a new revision reuses exactly matching published files and atomically refreshes identity", async () => {
	const { root, store } = await fixture();
	await store.publish(identity, bundle);
	const inode = (await files.lstat(join(root, "demo/site/index.html"))).ino;
	const rename = vi.fn(files.rename);
	const writeFile = vi.fn(files.writeFile);
	const refreshed = new StaticStore(root, { ...files, rename, writeFile });
	const next = { ...identity, revision: "b".repeat(40) };
	await refreshed.publish(next, [...bundle].reverse());
	expect(rename).not.toHaveBeenCalled();
	expect(writeFile).not.toHaveBeenCalled();
	expect((await files.lstat(join(root, "demo/site/index.html"))).ino).toBe(inode);
	expect(await store.inspect(next)).toBe("current");
	expect(await store.inspect(identity)).toBe("different");
	await refreshed.publish(next, bundle, { force: true });
	expect(rename).toHaveBeenCalled();
	expect(writeFile).toHaveBeenCalledTimes(2);
});

test("reuse requires a full successful scan and exact bytes, including extra-file removal", async () => {
	const { root, store } = await fixture();
	await store.publish(identity, bundle);
	const next = { ...identity, revision: "b".repeat(40) };
	const rename = vi.fn(files.rename);
	const failing = new StaticStore(root, {
		...files,
		rename,
		readFileBytes: async () => {
			throw new Error("unreadable bundle");
		},
	});
	await expect(failing.publish(next, bundle)).rejects.toThrow();
	expect(rename).not.toHaveBeenCalled();
	expect(await store.inspect(identity)).toBe("current");
	await files.writeFile(join(root, "demo/site/index.html"), "tampered");
	await files.writeFile(join(root, "demo/site/extra"), "extra");
	await store.publish(next, bundle);
	expect(await store.inspect(next)).toBe("current");
	expect(await store.read("demo", "site", "index.html")).toEqual(bundle[0]!.content);
	expect(await store.read("demo", "site", "extra")).toBeUndefined();
});

test("a failed identity refresh retains usable content and the old identity until retry", async () => {
	const { root, store } = await fixture();
	await store.publish(identity, bundle);
	const inode = (await files.lstat(join(root, "demo/site/index.html"))).ino;
	const next = { ...identity, revision: "b".repeat(40) };
	const write = vi.fn(files.atomicWriteFile).mockRejectedValueOnce(new Error("manifest unavailable"));
	const refreshed = new StaticStore(root, { ...files, atomicWriteFile: write });
	await expect(refreshed.publish(next, bundle)).rejects.toThrow();
	expect(await store.inspect(identity)).toBe("current");
	expect(await store.read("demo", "site", "index.html")).toEqual(bundle[0]!.content);
	expect((await files.lstat(join(root, "demo/site/index.html"))).ino).toBe(inode);
	await refreshed.publish(next, bundle);
	expect(await store.inspect(next)).toBe("current");
	expect((await files.lstat(join(root, "demo/site/index.html"))).ino).toBe(inode);
});

test("publishes exact files, replaces stale files, persists identity and detects tampering", async () => {
	const { root, store } = await fixture();
	expect(await store.inspect(identity)).toBe("missing");
	await store.publish(identity, bundle);
	expect(await store.inspect(identity)).toBe("current");
	expect(await new StaticStore(root, files).inspect(identity)).toBe("current");
	expect(await store.read("demo", "site", "assets/a.bin")).toEqual(new Uint8Array([0, 255]));
	await files.writeFile(join(root, "demo/site/stale"), "untracked");
	expect(await store.inspect(identity)).toBe("different");
	await store.publish(identity, [bundle[0]!]);
	expect(await store.read("demo", "site", "stale")).toBeUndefined();
	expect(await store.read("demo", "site", "assets/a.bin")).toBeUndefined();
	expect(await store.inspect({ ...identity, revision: "b".repeat(40) })).toBe("different");
	await files.writeFile(join(root, "demo/site/index.html"), "changed");
	expect(await store.inspect(identity)).toBe("different");
});

test.each(["../escape", "/escape", "a/../../escape", "a\\b", ".git/config", "a\0b"])(
	"rejects unsafe export file %j",
	async (path) => {
		const { store } = await fixture();
		await expect(store.publish(identity, [{ path, content: new Uint8Array() }])).rejects.toThrow();
	},
);

test("serving refuses traversal and symlinks, including a symlink resource root", async () => {
	const { root, store } = await fixture();
	await store.publish(identity, bundle);
	await files.symlink(join(root, "demo/site/index.html"), join(root, "demo/site/link"));
	for (const path of ["../site/index.html", "/index.html", "link", "assets/../../index.html", "a\\b"])
		expect(await store.read("demo", "site", path)).toBeUndefined();
	expect(await store.inspect(identity)).toBe("different");
	await files.rename(join(root, "demo/site"), join(root, "demo/old"));
	await files.symlink(join(root, "demo/old"), join(root, "demo/site"));
	expect(await store.read("demo", "site", "index.html")).toBeUndefined();
	await store.publish(identity, bundle);
	expect(await store.inspect(identity)).toBe("current");
});

test("invalid input or failed staging retains the previous published bundle", async () => {
	const { root, store } = await fixture();
	await store.publish(identity, bundle);
	await expect(store.publish(identity, [{ path: "../escape", content: new Uint8Array() }])).rejects.toThrow();
	const failing = new StaticStore(root, {
		...files,
		writeFile: async () => {
			throw new Error("disk full");
		},
	});
	await expect(failing.publish(identity, bundle, { force: true })).rejects.toThrow();
	expect(await store.inspect(identity)).toBe("current");
});

test("failed promotion restores the previous directory; failed rollback retains its backup", async () => {
	const { root, store } = await fixture();
	await store.publish(identity, bundle);
	let renames = 0;
	const failing = new StaticStore(root, {
		...files,
		rename: async (...args) => {
			renames++;
			if (renames === 2) throw new Error("promotion failed");
			return files.rename(...args);
		},
	});
	await expect(failing.publish(identity, [bundle[0]!])).rejects.toThrow();
	expect(await store.inspect(identity)).toBe("current");
	renames = 0;
	const failedRollback = new StaticStore(root, {
		...files,
		rename: async (...args) => {
			renames++;
			if (renames >= 2) throw new Error("disk unavailable");
			return files.rename(...args);
		},
	});
	await expect(failedRollback.publish(identity, [bundle[0]!])).rejects.toThrow();
	const backup = (await files.readdir(join(root, "demo"))).find((entry) => entry.endsWith(".previous"));
	expect(backup).toBeDefined();
	expect(await files.readFile(join(root, "demo", backup!, "index.html"))).toBe("hello");
});
