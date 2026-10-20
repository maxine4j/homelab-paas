import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import { FileReconciliationStore } from "./file-reconciliation-store.ts";

test("persists checkpoints and endpoints across instances without overwriting other routes", async () => {
	const directory = await mkdtemp(join(tmpdir(), "paas-reconciliation-"));
	try {
		const store = new FileReconciliationStore(directory);
		expect(await store.read("demo")).toBeUndefined();
		expect(await store.getAll()).toEqual({});
		const state = {
			desiredRevision: "rev",
			activeRevision: "old",
			phase: "failed" as const,
			error: "safe",
			failures: 2,
			retryAt: 1234,
		};
		await store.write("demo", state);
		const endpoint = { address: "10.0.0.2", port: 8080, healthcheckPath: "/health", public: false };
		await store.set("demo", endpoint);
		await store.set("other", endpoint);
		const restarted = new FileReconciliationStore(directory);
		expect(await restarted.read("demo")).toEqual(state);
		expect(await restarted.getAll()).toEqual({ demo: endpoint, other: endpoint });
		await restarted.set("demo", undefined);
		expect(await store.getAll()).toEqual({ other: endpoint });
		expect((await stat(join(directory, "demo.state.yaml"))).mode & 0o777).toBe(0o600);
		expect(await readFile(join(directory, "routes.yaml"), "utf8")).not.toContain("demo");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("validates persisted data, sanitizes failures and rejects routes without an ingress policy", async () => {
	const directory = await mkdtemp(join(tmpdir(), "paas-reconciliation-"));
	try {
		const store = new FileReconciliationStore(directory);
		await writeFile(join(directory, "routes.yaml"), "demo:\n  address: 10.0.0.2\n  port: 80\n");
		await expect(store.getAll()).rejects.toThrow("Cannot read reconciliation data");
		await writeFile(join(directory, "routes.yaml"), "secret: [PASSWORD");
		await expect(store.getAll()).rejects.toThrow("Cannot read reconciliation data");
		await writeFile(join(directory, "demo.state.yaml"), "phase: garbage\n");
		await expect(store.read("demo")).rejects.toThrow("Cannot read reconciliation data");
		await expect(store.write("../escape", { phase: "ready" })).rejects.toThrow();
		await expect(new FileReconciliationStore(join(directory, "routes.yaml")).getAll()).rejects.toThrow(
			"Cannot read reconciliation data",
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
