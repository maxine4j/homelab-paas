import { start } from "./start.ts";
import { logFatalError } from "./util/fatal-error.ts";
import { createLifecycle } from "./util/lifecycle.ts";
import { logger } from "./util/logger.ts";

const lifecycle = createLifecycle();

process
	.on("SIGTERM", async () => {
		logger.info({}, "Received SIGTERM; shutting down");
		await lifecycle.shutdown();
		process.exit(0);
	})
	.on("SIGINT", async () => {
		logger.info({}, "Received SIGINT; shutting down");
		await lifecycle.shutdown();
		process.exit(0);
	})
	.on("uncaughtException", async (error) => {
		logFatalError("uncaughtException", error);
		await lifecycle.shutdown();
		process.exit(1);
	})
	.on("unhandledRejection", async (reason) => {
		logFatalError("unhandledRejection", reason);
		await lifecycle.shutdown();
		process.exit(1);
	});

const main = async () => {
	await start(lifecycle);
};

main();
