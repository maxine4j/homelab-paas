import { expect, test } from "vitest";

import { ReconcilerTask } from "./reconciler-task.ts";

test("awaits reconciliation and propagates failures to the periodic runner", async () => {
	let release = () => {};
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	let finished = false;
	const running = new ReconcilerTask({ reconcile: () => blocked }).run().then(() => {
		finished = true;
	});
	await Promise.resolve();
	expect(finished).toBe(false);
	release();
	await running;
	expect(finished).toBe(true);
	await expect(
		new ReconcilerTask({
			async reconcile() {
				throw new Error("failed");
			},
		}).run(),
	).rejects.toThrow("failed");
});
