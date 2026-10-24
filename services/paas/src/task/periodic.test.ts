import { expect, test } from "vitest";

import { PeriodicTaskRunner } from "./periodic.ts";

test("runs at startup and serially each period, reports failures and stops with the lifecycle", async () => {
	let open = true;
	let runs = 0;
	const waits: number[] = [];
	let failures = 0;
	const failure = new Error("private details");
	let reported: unknown;
	const runner = new PeriodicTaskRunner({
		lifecycle: {
			isOpen: () => open,
			registerShutdownHandler() {},
			async shutdown() {
				open = false;
			},
		},
		periodMs: 5000,
		taskName: "test",
		generateTaskId: () => "id",
		task: {
			async run() {
				runs++;
				if (runs === 1) throw failure;
			},
		},
		pause: async (ms: number) => {
			waits.push(ms);
			if (runs === 2) open = false;
		},
		report: (error: unknown) => {
			reported = error;
			failures++;
		},
	});
	await runner.start();
	expect(runs).toBe(2);
	expect(waits).toEqual([5000, 5000]);
	expect(failures).toBe(1);
	expect(reported).toBe(failure);
});
