import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { FileSystemKeyValueStore } from "../store/file-system-store.ts";
import { InMemoryKeyValueStore } from "../store/in-memory-store.ts";
import type { KeyValueStore } from "../store/types.ts";
import { atomicWriteFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "../util/file.ts";
import { EndpointsStore } from "./networking/endpoints-store.ts";
import { ReconciliationStore } from "./reconciliation-store.ts";

const endpoint = { address: "10.0.0.2", port: 8080, healthcheckPath: "/health", public: false };
const fileStore = (directory: string) =>
	new FileSystemKeyValueStore<unknown>(
		directory,
		readFile,
		async (path, content) => {
			await mkdir(directory, { recursive: true, mode: 0o700 });
			await atomicWriteFile(path, content);
		},
		async (path) => {
			await rm(path, { force: true });
		},
		"yaml",
	);

const contract = (given: () => Promise<KeyValueStore<unknown>>) => {
	test.each([undefined, null])("persists routes without HTTP checks: %s", async (healthcheckPath) => {
		const values = await given();
		const store = new EndpointsStore(values);
		await store.set("demo", { ...endpoint, healthcheckPath });
		expect((await new EndpointsStore(values).getAll())["demo"]?.healthcheckPath).toBe(healthcheckPath);
	});
	test("persists deployment start times across store recreation and validates timestamps", async () => {
		const values = await given();
		await new ReconciliationStore(values).write("demo", { phase: "deploying", deploymentStartedAt: 0 });
		expect(await new ReconciliationStore(values).read("demo")).toEqual({
			phase: "deploying",
			deploymentStartedAt: 0,
		});
		for (const deploymentStartedAt of [-1, Infinity, "invalid"]) {
			await values.set("demo.state", { phase: "deploying", deploymentStartedAt });
			await expect(new ReconciliationStore(values).read("demo")).rejects.toThrow(
				"Cannot read reconciliation data",
			);
		}
	});
	test("validates and copies checkpoints and preserves legacy pending states", async () => {
		const values = await given();
		const store = new ReconciliationStore(values);
		expect(await store.read("demo")).toBeUndefined();
		await values.set("demo.state", { phase: "pending" });
		expect(await store.read("demo")).toEqual({ phase: "deploying" });
		const state = { phase: "ready" as const };
		await store.write("demo", state);
		Object.assign(state, { phase: "failed" });
		const copy = await store.read("demo");
		if (copy) copy.phase = "failed";
		expect(await store.read("demo")).toEqual({ phase: "ready" });
		await values.set("demo.state", { phase: "garbage", secret: "credential" });
		await expect(store.read("demo")).rejects.toThrow("Cannot read reconciliation data");
		await expect(store.write("../escape", { phase: "ready" })).rejects.toThrow(
			"Invalid reconciliation service identity",
		);
	});
	test("preserves other routes and returns defensive copies with explicit policy", async () => {
		const values = await given();
		const store = new EndpointsStore(values);
		expect(await store.getAll()).toEqual({});
		await store.set("demo", endpoint);
		await store.set("other", endpoint);
		const copy = await store.getAll();
		if (copy["demo"]) copy["demo"].public = true;
		expect(await store.getAll()).toEqual({ demo: endpoint, other: endpoint });
		await store.set("demo", undefined);
		expect(await store.getAll()).toEqual({ other: endpoint });
		await values.set("routes", { demo: { address: "10.0.0.2", port: 80 } });
		await expect(store.getAll()).rejects.toThrow("Cannot read reconciliation data");
	});
	test("rejects null routes instead of silently losing persisted state", async () => {
		const values = await given();
		await values.set("routes", null);
		await expect(new EndpointsStore(values).getAll()).rejects.toThrow("Cannot read reconciliation data");
	});
};

describe("memory domain wrappers", () => contract(async () => new InMemoryKeyValueStore<unknown>()));
describe("filesystem domain wrappers", () => {
	const directories: string[] = [];
	afterEach(async () => {
		await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
	});
	contract(async () => {
		const directory = await mkdtemp(join(tmpdir(), "paas-state-"));
		directories.push(directory);
		return fileStore(directory);
	});
	test("persists canonical YAML paths, private permissions and sanitized malformed input", async () => {
		const directory = await mkdtemp(join(tmpdir(), "paas-state-"));
		directories.push(directory);
		await new ReconciliationStore(fileStore(directory)).write("demo", { phase: "ready" });
		await new EndpointsStore(fileStore(directory)).set("demo", endpoint);
		expect(await new ReconciliationStore(fileStore(directory)).read("demo")).toEqual({ phase: "ready" });
		expect((await stat(join(directory, "demo.state.yaml"))).mode & 0o777).toBe(0o600);
		expect(await readFile(join(directory, "routes.yaml"))).toContain("public: false");
		await writeFile(join(directory, "routes.yaml"), "secret: [PASSWORD");
		await expect(new EndpointsStore(fileStore(directory)).getAll()).rejects.toThrow(
			"Cannot read reconciliation data",
		);
		await expect(new EndpointsStore(fileStore(join(directory, "routes.yaml"))).getAll()).rejects.toThrow(
			"Cannot read reconciliation data",
		);
	});
});
