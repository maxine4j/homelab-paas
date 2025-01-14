import { Lifecycle } from '../util/lifecycle'
import { logger } from '../util/logger';
import { sleep } from '../util/sleep'
import { TaskRunner } from './types';

export interface StartupTask {
  (): Promise<void>
}

export const createStartupTaskRunner = (args: {
  runTask: StartupTask,
}): TaskRunner => {

  return {
    start: async () => {
      try {
        await args.runTask();
      } catch (error) {
        logger.error(error);
      }
    }
  };
};
