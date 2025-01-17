import { Lifecycle } from '../util/lifecycle'
import { logger } from '../util/logger';
import { sleep } from '../util/sleep'
import { TaskRunner } from './types';

export interface QueueTask<TTask> {
  run(task: TaskEnvelope<TTask>): Promise<void>
}

export interface TaskEnvelope<TTask> {
  taskId: string
  task: TTask
}

export interface TaskQueue<TTask> {
  enqueue(task: TTask): Promise<void>
  dequeue(): Promise<TaskEnvelope<TTask> | undefined>
}

export class InMemoryTaskQueue<TTask> implements TaskQueue<TTask> {
  
  private queue: TaskEnvelope<TTask>[] = [];

  constructor(
    private readonly generateTaskId: () => string,
  ) {}

  public async enqueue(task: TTask) { 
    this.queue.push({ taskId: this.generateTaskId(), task }) 
  }

  public async dequeue() {
    return this.queue.pop()
  }
}

export class QueueTaskRunner<TTask> implements TaskRunner {
  
  constructor(
    private readonly lifecycle: Lifecycle,
    private readonly queue: TaskQueue<TTask>,
    private readonly idleDelayMs: number,
    private readonly runTask: QueueTask<TTask>,
  ) {}

  public async start() {
    while (this.lifecycle.isOpen()) {
      const task = await this.queue.dequeue();
      if (!task) {
        await sleep(this.idleDelayMs);
        continue;
      }
      try {
        await this.runTask(task);
      } catch (error) {
        logger.error(error);
      }
    }
  }
}
