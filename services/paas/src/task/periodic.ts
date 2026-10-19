import { type Lifecycle } from "../util/lifecycle.ts";
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
			pause: (ms: number) => Promise<void>;
			report: () => void;
		},
	) {}

	public async start() {
		while (this.deps.lifecycle.isOpen()) {
			try {
				await this.deps.task.run();
			} catch {
				this.deps.report();
			}
			if (this.deps.lifecycle.isOpen()) await this.deps.pause(this.deps.periodMs);
		}
	}
}
