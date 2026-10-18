import type { Logger } from "../util/logging.ts";
import type { TaskRunner } from "./types.ts";

export interface StartupTask {
  run(): Promise<void>;
}

export class StartupTaskRunner implements TaskRunner {
  private readonly task: StartupTask;
  private readonly logger: Logger;
  constructor(task: StartupTask, logger: Logger) {
    this.task = task;
    this.logger = logger;
  }

  public async start() {
    try {
      await this.task.run();
    } catch {
      this.logger.error({ operation: "run_task" }, "Task failed");
    }
  }
}
