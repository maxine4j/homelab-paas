import { logFatalError } from "./fatal-error.ts";
import { createLifecycle, type Lifecycle } from "./lifecycle.ts";
import { logger } from "./logger.ts";

/** Shared process setup for production and alternate composition entrypoints. */
export const runProcess = (start: (lifecycle: Lifecycle) => Promise<unknown>): void => {
	const lifecycle = createLifecycle();
	for (const signal of ["SIGTERM", "SIGINT"] as const) {
		process.on(signal, async () => {
			logger.info({ signal }, "Received shutdown signal");
			await lifecycle.shutdown();
			process.exit(0);
		});
	}
	for (const event of ["uncaughtException", "unhandledRejection"] as const) {
		process.on(event, async (failure: unknown) => {
			logFatalError(event, failure);
			await lifecycle.shutdown();
			process.exit(1);
		});
	}
	void start(lifecycle);
};
