import { type Lifecycle } from "../util/lifecycle.ts";
import { logger, withLogContext } from "../util/logger.ts";
import type { ISleep } from "../util/sleep.ts";
import { type TaskRunner } from "./types.ts";

export interface QueueTask<TTask> {
	run(task: TaskEnvelope<TTask>): Promise<void>;
}

export interface TaskEnvelope<TTask> {
	taskId: string;
	task: TTask;
}

export interface TaskQueue<TTask> {
	enqueue(task: TTask): Promise<void>;
	dequeue(): Promise<TaskEnvelope<TTask> | undefined>;
}

export class InMemoryTaskQueue<TTask> implements TaskQueue<TTask> {
	private queue: TaskEnvelope<TTask>[] = [];

	constructor(private readonly generateTaskId: () => string) {}

	public async enqueue(task: TTask) {
		this.queue.push({ taskId: this.generateTaskId(), task });
	}

	public async dequeue() {
		return this.queue.pop();
	}
}

export class QueueTaskRunner<TTask> implements TaskRunner {
	constructor(
		private readonly deps: {
			lifecycle: Lifecycle;
			queue: TaskQueue<TTask>;
			idleDelayMs: number;
			taskName: string;
			generateTaskId: () => string;
			task: QueueTask<TTask>;
			pause: ISleep;
		},
	) {}

	public async start() {
		while (this.deps.lifecycle.isOpen()) {
			const taskEnvelope = await this.deps.queue.dequeue();
			if (!taskEnvelope) {
				await this.deps.pause(this.deps.idleDelayMs);
				continue;
			}
			const taskId = this.deps.generateTaskId();
			await withLogContext({ task: this.deps.taskName, taskId }, async () => {
				try {
					await this.deps.task.run({ ...taskEnvelope, taskId });
				} catch (err) {
					logger.error({ err }, "Queued task failed");
				}
			});
		}
	}
}
