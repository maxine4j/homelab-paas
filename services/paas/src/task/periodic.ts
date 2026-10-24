import { type Lifecycle } from "../util/lifecycle.ts";
import { withLogContext } from "../util/logger.ts";
import { type TaskRunner } from "./types.ts";

export interface PeriodicTask {
	run(): Promise<void>;
}

export class PeriodicTaskRunner implements TaskRunner {
	constructor(
		private readonly deps: {
			lifecycle: Lifecycle;
			periodMs: number | (() => number);
			taskName: string;
			generateTaskId: () => string;
			task: PeriodicTask;
			pause: (ms: number) => Promise<void>;
			report: (error: unknown) => void;
		},
	) {}

	public async start() {
		while (this.deps.lifecycle.isOpen()) {
			await withLogContext({ task: this.deps.taskName, taskId: this.deps.generateTaskId() }, async () => {
				try {
					await this.deps.task.run();
				} catch (error) {
					this.deps.report(error);
				}
			});
			if (this.deps.lifecycle.isOpen())
				await this.deps.pause(
					typeof this.deps.periodMs === "function" ? this.deps.periodMs() : this.deps.periodMs,
				);
		}
	}
}
