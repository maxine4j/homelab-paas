import type { Lifecycle } from "../util/lifecycle.ts";
import type { Logger } from "../util/logging.ts";
import type { TaskRunner } from "./types.ts";

export interface PeriodicTask {
  run(): Promise<void>;
}

export interface PeriodicTaskRunnerDependencies {
  lifecycle: Lifecycle;
  periodMs: number;
  task: PeriodicTask;
  sleep(delayMs: number): Promise<void>;
}

export class PeriodicTaskRunner implements TaskRunner {
  private readonly logger: Logger;
  private readonly deps: PeriodicTaskRunnerDependencies;
  constructor(deps: PeriodicTaskRunnerDependencies, logger: Logger) {
    this.deps = deps;
    this.logger = logger;
  }

  public async start() {
    while (this.deps.lifecycle.isOpen()) {
      try {
        await this.deps.task.run();
      } catch {
        this.logger.error({ operation: "run_task" }, "Task failed");
      }
      await this.deps.sleep(this.deps.periodMs);
    }
  }
}
