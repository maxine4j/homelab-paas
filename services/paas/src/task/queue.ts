import type { Lifecycle } from "../util/lifecycle.ts";
import type { Logger } from "../util/logging.ts";
import type { TaskRunner } from "./types.ts";

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

  private readonly generateTaskId: () => string;
  constructor(generateTaskId: () => string) {
    this.generateTaskId = generateTaskId;
  }

  public async enqueue(task: TTask) {
    this.queue.push({ taskId: this.generateTaskId(), task });
  }

  public async dequeue() {
    return this.queue.pop();
  }
}

export interface QueueTaskRunnerDependencies<TTask> {
  lifecycle: Lifecycle;
  queue: TaskQueue<TTask>;
  idleDelayMs: number;
  task: QueueTask<TTask>;
  sleep(delayMs: number): Promise<void>;
}

export class QueueTaskRunner<TTask> implements TaskRunner {
  private readonly logger: Logger;
  private readonly deps: QueueTaskRunnerDependencies<TTask>;
  constructor(deps: QueueTaskRunnerDependencies<TTask>, logger: Logger) {
    this.deps = deps;
    this.logger = logger;
  }

  public async start() {
    while (this.deps.lifecycle.isOpen()) {
      const taskEnvelope = await this.deps.queue.dequeue();
      if (!taskEnvelope) {
        await this.deps.sleep(this.deps.idleDelayMs);
        continue;
      }
      try {
        await this.deps.task.run(taskEnvelope);
      } catch {
        this.logger.error({ operation: "run_task" }, "Task failed");
      }
    }
  }
}
