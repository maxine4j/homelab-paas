import { expect, test } from "vitest";

import { QueueTaskRunner } from "./queue.ts";

test("an empty queue waits through the injected pause before polling again", async () => {
	let open = true;
	let polls = 0;
	const pauses: number[] = [];
	await new QueueTaskRunner({
		lifecycle: {
			isOpen: () => open,
			registerShutdownHandler() {},
			async shutdown() {
				open = false;
			},
		},
		queue: {
			async enqueue() {},
			async dequeue() {
				if (++polls === 2) open = false;
				return undefined;
			},
		},
		idleDelayMs: 0,
		taskName: "queue",
		generateTaskId: () => "id",
		task: { async run() {} },
		pause: async (ms) => {
			pauses.push(ms);
		},
	}).start();
	expect(pauses).toEqual([0, 0]);
	expect(polls).toBe(2);
});
