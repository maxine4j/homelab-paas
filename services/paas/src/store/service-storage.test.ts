import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import * as files from "../util/file.ts";
import { ServiceStorage } from "./service-storage.ts";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => files.rm(root, { recursive: true, force: true })));
});
const fixture = async () => {
	const root = await files.mkdtemp(join(tmpdir(), "service-storage-"));
	roots.push(root);
	return { root, store: new ServiceStorage(root, files) };
};
test("persists service state, events, health and routes in private service directories across restart", async () => {
	const { root, store } = await fixture();
	for (const name of ["state", "events", "health", "routes"]) {
		await store.set(`demo.${name}`, { value: name });
		expect(await files.readFile(join(root, "demo", `${name}.yaml`))).toBe(`value: ${name}\n`);
		expect(await new ServiceStorage(root, files).get(`demo.${name}`)).toEqual({ value: name });
	}
	expect((await files.stat(join(root, "demo"))).mode & 0o777).toBe(0o700);
	expect((await files.stat(join(root, "demo/state.yaml"))).mode & 0o777).toBe(0o600);
	await store.update("demo.state", async () => ({ value: "changed" }));
	expect(await store.get("demo.state")).toEqual({ value: "changed" });
	await store.delete("demo.state");
	expect(await store.get("demo.state")).toBeUndefined();
});
test("discovers removed services too, excluding platform and unrelated entries", async () => {
	const { root, store } = await fixture();
	await store.set("gone.routes", {});
	await store.set("demo.state", {});
	await files.mkdir(join(root, "_paas"));
	await files.writeFile(join(root, "notes"), "notes");
	expect((await store.listServices()).sort()).toEqual(["demo", "gone"]);
});
test("rejects unsafe keys and symlinked service directories without touching their targets", async () => {
	const { root, store } = await fixture();
	for (const key of ["../state", "demo.other", "_paas.state", "demo.state.extra"])
		await expect(store.set(key, {})).rejects.toThrow();
	await files.mkdir(join(root, "target"));
	await files.symlink(join(root, "target"), join(root, "demo"));
	await expect(store.set("demo.state", {})).rejects.toThrow();
	expect(await files.readdir(join(root, "target"))).toEqual([]);
});
