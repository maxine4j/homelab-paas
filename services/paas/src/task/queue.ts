import { Lifecycle } from '../util/lifecycle'
import { logger } from '../util/logger';
import { sleep } from '../util/sleep'
import { TaskRunner } from './types';

export interface QueueTask<TTask> {
  (task: TaskEnvelope<TTask>): Promise<void>
}

export interface TaskEnvelope<TTask> {
  taskId: string
  task: TTask
}

export interface TaskQueue<TTask> {
  enqueue: (task: TTask) => Promise<void>
  dequeue: () => Promise<TaskEnvelope<TTask> | undefined>
}

export const createInMemoryTaskQueue = <TTask>(
  generateTaskId: () => string,
): TaskQueue<TTask> => {
  const queue: TaskEnvelope<TTask>[] = [];

  return {
    enqueue: async (task) => { queue.push({ taskId: generateTaskId(), task }) },
    dequeue: async () => queue.pop(),
  };
};

export const createQueueTaskRunner = <TTask>(args: {
  lifecycle: Lifecycle,
  queue: TaskQueue<TTask>,
  runTask: QueueTask<TTask>,
  idleDelayMs: number,
}): TaskRunner => {

  return {
    start: async () => {
      while (args.lifecycle.isOpen()) {
        const task = await args.queue.dequeue();
        if (!task) {
          await sleep(args.idleDelayMs);
          continue;
        }
        try {
          await args.runTask(task);
        } catch (error) {
          logger.error(error);
        }
      }
    }
  };
};
