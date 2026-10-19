import { type Lifecycle } from "../util/lifecycle.ts";
import { logger } from "../util/logger.ts";
import { sleep } from "../util/sleep.ts";
import { type TaskRunner } from "./types.ts";

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
