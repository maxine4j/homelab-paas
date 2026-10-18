import { Lifecycle } from '../util/lifecycle';
import { logger } from '../util/logger';
import { sleep } from '../util/sleep';
import { TaskRunner } from './types';

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
      task: QueueTask<TTask>;
    },
  ) {}

  public async start() {
    while (this.deps.lifecycle.isOpen()) {
      const taskEnvelope = await this.deps.queue.dequeue();
      if (!taskEnvelope) {
        await sleep(this.deps.idleDelayMs);
        continue;
      }
      try {
        await this.deps.task.run(taskEnvelope);
      } catch (error) {
        logger.error(error);
      }
    }
  }
}
