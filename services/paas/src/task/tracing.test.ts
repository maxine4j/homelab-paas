import { expect, test } from "vitest";

import { createLogger } from "../util/logger.ts";
import { captureLogs } from "../util/test/logs.ts";
import { PeriodicTaskRunner } from "./periodic.ts";
import { InMemoryTaskQueue, QueueTaskRunner } from "./queue.ts";
import { StartupTaskRunner } from "./startup.ts";

test("all task runners scope each execution and failure report, without logging idle runs", async () => {
	const lines: string[] = [];
	const log = createLogger("nested-service", { write: (line: string) => lines.push(line) });
	let sequence = 0;
	const generateTaskId = () => `run-${++sequence}`;
	let open = true;
	let pauses = 0;
	const lifecycle = {
		isOpen: () => open,
		registerShutdownHandler() {},
		async shutdown() {
			open = false;
		},
	};
	const seen: string[] = [];
	await new PeriodicTaskRunner({
		lifecycle,
		periodMs: 1,
		taskName: "reconcile",
		generateTaskId,
		task: {
			async run() {
				log.info("drift");
				if (!seen.length) throw new Error("SECRET");
			},
		},
		report: () => {
			log.warn("retry");
			seen.push("failure");
		},
		pause: async () => {
			if (++pauses === 2) open = false;
		},
	}).start();
	await new StartupTaskRunner(
		{
			async run() {
				await Promise.resolve();
				log.info("startup");
			},
		},
		"bootstrap",
		generateTaskId,
	).start();
	const queue = new InMemoryTaskQueue<string>(() => "envelope-id");
	await queue.enqueue("payload");
	open = true;
	await new QueueTaskRunner({
		lifecycle,
		queue,
		idleDelayMs: 1,
		pause: async () => {},
		taskName: "queued",
		generateTaskId,
		task: {
			async run(envelope) {
				log.info({ envelopeId: envelope.taskId }, "queued");
				open = false;
			},
		},
	}).start();
	log.info("outside");
	const records = lines.map((line) => JSON.parse(line));
	expect(records.map(({ task, taskId }) => [task, taskId])).toEqual([
		["reconcile", "run-1"],
		["reconcile", "run-1"],
		["reconcile", "run-2"],
		["bootstrap", "run-3"],
		["queued", "run-4"],
		[undefined, undefined],
	]);
	expect(lines.join("")).not.toContain("SECRET");
	expect(records.at(4).envelopeId).toBe("run-4");
});

test("startup and queue runners log original failures inside their task context", async () => {
	const capture = captureLogs();
	const cause = new Error("root failure");
	const err = new Error("task failure", { cause });
	try {
		await new StartupTaskRunner(
			{
				run: async () => {
					throw err;
				},
			},
			"startup",
			() => "startup-id",
		).start();
		let open = true;
		const queue = new InMemoryTaskQueue<string>(() => "envelope-id");
		await queue.enqueue("payload");
		await new QueueTaskRunner({
			lifecycle: { isOpen: () => open, registerShutdownHandler() {}, async shutdown() {} },
			queue,
			idleDelayMs: 1,
			taskName: "queue",
			generateTaskId: () => "queue-id",
			pause: async () => {},
			task: {
				run: async () => {
					open = false;
					throw err;
				},
			},
		}).start();
	} finally {
		capture.restore();
	}
	const records = capture.lines.map((line) => JSON.parse(line));
	expect(records).toHaveLength(2);
	for (const record of records) {
		expect(record.err.cause.message).toBe("root failure");
		expect(record.err.stack).toContain("caused by: Error: root failure");
		expect(record.taskId).toBe(`${record.task}-id`);
	}
});
