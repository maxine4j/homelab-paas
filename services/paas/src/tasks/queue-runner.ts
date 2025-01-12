import { Lifecycle } from '../util/lifecycle'
import { logger } from '../util/logger';
import { sleep } from '../util/sleep'
import { TaskQueue } from './queue';
import { TaskEnvelope } from './types';

export const createQueueTaskRunner = <TTask>(args: {
  lifecycle: Lifecycle,
  queue: TaskQueue<TTask>,
  runTask: (task: TaskEnvelope<TTask>) => Promise<void>,
  idleDelayMs: number,
}) => {

  return async () => {

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
  };
};
