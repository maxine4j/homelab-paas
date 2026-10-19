import { logger } from "../util/logger.ts";
import { type TaskRunner } from "./types.ts";

export interface StartupTask {
	run(): Promise<void>;
}

export class StartupTaskRunner implements TaskRunner {
	constructor(private readonly task: StartupTask) {}

	public async start() {
		try {
			await this.task.run();
		} catch (error) {
			logger.error(error);
		}
	}
}
