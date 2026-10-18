import { Lifecycle } from '../util/lifecycle';
import { logger } from '../util/logger';
import { sleep } from '../util/sleep';
import { TaskRunner } from './types';

export interface PeriodicTask {
  run(): Promise<void>;
}

export class PeriodicTaskRunner implements TaskRunner {
  constructor(
    private readonly deps: {
      lifecycle: Lifecycle;
      periodMs: number;
      task: PeriodicTask;
    },
  ) {}

  public async start() {
    while (this.deps.lifecycle.isOpen()) {
      try {
        await this.deps.task.run();
      } catch (error) {
        logger.error(error);
      }
      await sleep(this.deps.periodMs);
    }
  }
}
