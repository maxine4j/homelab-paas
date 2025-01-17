import { Lifecycle } from '../util/lifecycle'
import { logger } from '../util/logger';
import { sleep } from '../util/sleep'
import { TaskRunner } from './types';

export interface PeriodicTask {
  run(): Promise<void>
}

export class PeriodicTaskRunner implements TaskRunner {
  constructor(
    private readonly lifecycle: Lifecycle,
    private readonly periodMs: number,
    private readonly task: PeriodicTask,
  ) {}

  public async start() {
    while (this.lifecycle.isOpen()) {
      try {
        await this.task.run();
      } catch (error) {
        logger.error(error);
      }
      await sleep(this.periodMs);
    }
  }
}
