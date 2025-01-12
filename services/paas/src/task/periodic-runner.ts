import { Lifecycle } from '../util/lifecycle'
import { logger } from '../util/logger';
import { sleep } from '../util/sleep'

export const createPeriodicTaskRunner = (args: {
  lifecycle: Lifecycle,
  periodMs: number,
  runTask: () => Promise<void>,
}) => {

  return async () => {

    while (args.lifecycle.isOpen()) {
      await sleep(args.periodMs);
      try {
        await args.runTask();
      } catch (error) {
        logger.error(error);
      }
    }
  };
};
