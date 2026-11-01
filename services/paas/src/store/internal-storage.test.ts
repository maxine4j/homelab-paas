import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import * as files from "../util/file.ts";
import { parseYaml } from "../util/yaml.ts";
import { InternalStorage } from "./internal-storage.ts";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => files.rm(root, { recursive: true, force: true })));
});
const fixture = async () => {
	const root = await files.mkdtemp(join(tmpdir(), "paas-storage-"));
	roots.push(root);
	const storage = new InternalStorage(root, files, join(root, "etc"));
	const put = async (name: string, value = "keep") => {
		const path = join(root, name);
		await files.mkdir(join(path, ".."), { recursive: true });
		await files.writeFile(path, value);
	};
	return { root, storage, put };
};

test("generates a private Envoy bootstrap without changing existing TLS or static output", async () => {
	const { root, storage, put } = await fixture();
	await put("_paas/static/demo/site/index.html", "bundle");
	await put("_paas/envoy/ingress.pem", "certificate and key");
	await put("_paas/acme-account.pem", "account key");
	await storage.initialize();
	expect((await files.stat(join(root, "_paas/envoy/envoy.yaml"))).mode & 0o777).toBe(0o600);
	expect(await files.readFile(join(root, "_paas/static/demo/site/index.html"))).toBe("bundle");
	expect(await files.readFile(join(root, "_paas/envoy/ingress.pem"))).toBe("certificate and key");
	expect(await files.readFile(join(root, "_paas/acme-account.pem"))).toBe("account key");
	const bootstrap = parseYaml((await files.readFile(join(root, "_paas/envoy/envoy.yaml")))!, "bootstrap");
	expect(bootstrap).toMatchObject({
		dynamic_resources: { cds_config: { path_config_source: { path: "/var/homelab-paas/_paas/envoy/cds.yaml" } } },
	});
	await put("_paas/envoy/ingress.pem", "rotated key");
	await storage.initialize();
	expect(await files.readFile(join(root, "_paas/envoy/ingress.pem"))).toBe("rotated key");
});

test("cleanup removes only recognized obsolete internal output and preserves service data and private keys", async () => {
	const { root, storage, put } = await fixture();
	await storage.initialize();
	for (const name of [
		"demo/data/db",
		"demo/credentials.env",
		"_paas/acme-account.pem",
		"_paas/envoy/ingress.pem",
		"_paas/demo.state.yaml",
		"_paas/demo.events.yaml",
		"_paas/demo.health.yaml",
		"_paas/unknown",
		"_paas/static/demo/site/index.html",
		"_paas/git/demo/" + "a".repeat(64) + "/objects/keep",
	])
		await put(name);
	const obsolete = [
		"_paas/gone.state.yaml",
		"_paas/gone.events.yaml",
		"_paas/gone.health.yaml",
		"_paas/ui-git/gone/HEAD",
		"_paas/git/demo/HEAD",
		"_paas/git/demo/" + "b".repeat(64) + "/HEAD",
		"_paas/git/gone/" + "c".repeat(64) + "/HEAD",
		"_paas/static/gone/site/index.html",
		"_paas/cds.yaml",
		"_paas/lds.yaml",
		"_paas/sds.yaml",
		"_paas/ingress.pem",
	];
	for (const name of obsolete) await put(name);
	await storage.cleanup(() => ({ services: new Set(["demo"]), git: new Set(["demo/" + "a".repeat(64)]) }));
	for (const name of obsolete) expect(await files.readFile(join(root, name)), name).toBeUndefined();
	for (const name of [
		"demo/data/db",
		"demo/credentials.env",
		"_paas/acme-account.pem",
		"_paas/envoy/ingress.pem",
		"_paas/demo.state.yaml",
		"_paas/demo.events.yaml",
		"_paas/demo.health.yaml",
		"_paas/unknown",
		"_paas/static/demo/site/index.html",
	])
		expect(await files.readFile(join(root, name)), name).toBe("keep");
});

test("maintenance waits for active operations and blocks new operations until deletion finishes", async () => {
	const { storage } = await fixture();
	let release!: () => void;
	const order: string[] = [];
	const active = storage.use(async () => {
		order.push("active");
		await new Promise<void>((resolve) => {
			release = resolve;
		});
	});
	await Promise.resolve();
	const maintenance = storage.maintain(async () => {
		order.push("cleanup");
	});
	const next = storage.use(async () => {
		order.push("next");
	});
	expect(order).toEqual(["active"]);
	release();
	await Promise.all([active, maintenance, next]);
	expect(order).toEqual(["active", "cleanup", "next"]);
});

test("initialization and cleanup refuse symlinked internal directories and preserve their targets", async () => {
	const { root, storage, put } = await fixture();
	await put("service/credentials.env");
	await files.symlink(join(root, "service"), join(root, "_paas"));
	await expect(storage.initialize()).rejects.toThrow();
	await expect(storage.cleanup(() => ({ services: new Set(), git: new Set() }))).rejects.toThrow();
	expect(await files.readFile(join(root, "service/credentials.env"))).toBe("keep");
});

test("cleans obsolete static bundles and abandoned writes but preserves new publications and incomplete rollback backups", async () => {
	const { root, storage, put } = await fixture();
	await storage.initialize();
	const abandoned = "demo.state.yaml.12345678-1234-1234-1234-123456789abc.tmp";
	for (const name of [
		"_paas/static/demo/old/index.html",
		"_paas/static/demo/.old.json",
		"_paas/static/demo/live/index.html",
		"_paas/static/demo/.live.json",
		"_paas/static/demo/.missing.json",
		"_paas/static/demo/notes",
		"_paas/static/demo/.staging-abcd/unfinished",
		"_paas/static/demo/.staging-abcd.previous/backup",
		"_paas/" + abandoned,
		"_paas/envoy/" + abandoned,
		"__paas/static/demo/old/index.html",
		"etc/envoy.yaml",
		"_paas/do-not-delete.tmp",
	])
		await put(name);
	await storage.cleanup(() => ({
		before: Number.MAX_SAFE_INTEGER,
		services: new Set(["demo"]),
		git: new Set(),
		static: new Map([["demo", new Set(["live", "missing"])]]),
	}));
	for (const name of [
		"_paas/static/demo/old",
		"_paas/static/demo/.old.json",
		"_paas/static/demo/.staging-abcd",
		"_paas/" + abandoned,
		"_paas/envoy/" + abandoned,
		"__paas",
		"etc/envoy.yaml",
	])
		await expect(files.lstat(join(root, name)), name).rejects.toMatchObject({ code: "ENOENT" });
	expect(await files.readFile(join(root, "_paas/static/demo/live/index.html"))).toBe("keep");
	expect(await files.readFile(join(root, "_paas/do-not-delete.tmp"))).toBe("keep");
	expect(await files.readFile(join(root, "_paas/static/demo/notes"))).toBe("keep");
	// A backup without proof of complete replacement is retained.
	expect(await files.readFile(join(root, "_paas/static/demo/.staging-abcd.previous/backup"))).toBe("keep");
	await put("_paas/static/demo/fresh/index.html");
	await storage.cleanup(() => ({
		before: 0,
		services: new Set(["demo"]),
		git: new Set(),
		static: new Map([["demo", new Set()]]),
	}));
	expect(await files.readFile(join(root, "_paas/static/demo/fresh/index.html"))).toBe("keep");
});

test("failed maintenance releases waiting operations and can be retried", async () => {
	const { storage } = await fixture();
	const failed = storage.maintain(async () => {
		throw new Error("disk unavailable");
	});
	const next = storage.use(async () => "available");
	await expect(failed).rejects.toThrow("disk unavailable");
	expect(await next).toBe("available");
	await expect(storage.maintain(async () => "retried")).resolves.toBe("retried");
});
