import { logger, withLogContext } from "../util/logger.ts";
import { type TaskRunner } from "./types.ts";

export interface StartupTask {
	run(): Promise<void>;
}

export class StartupTaskRunner implements TaskRunner {
	constructor(
		private readonly task: StartupTask,
		private readonly taskName: string,
		private readonly generateTaskId: () => string,
	) {}

	public async start() {
		await withLogContext({ task: this.taskName, taskId: this.generateTaskId() }, async () => {
			try {
				await this.task.run();
			} catch (err) {
				logger.error({ err }, "Startup task failed");
			}
		});
	}
}
