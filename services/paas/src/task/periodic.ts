import { Lifecycle } from '../util/lifecycle'
import { logger } from '../util/logger';
import { sleep } from '../util/sleep'
import { TaskRunner } from './types';

export interface PeriodicTask {
  (): Promise<void>
}

export const createPeriodicTaskRunner = (args: {
  lifecycle: Lifecycle,
  periodMs: number,
  runTask: PeriodicTask,
}): TaskRunner => {

  return {
    start: async () => {
      while (args.lifecycle.isOpen()) {
        await sleep(args.periodMs);
        try {
          await args.runTask();
        } catch (error) {
          logger.error(error);
        }
      }
    }
  };
};
