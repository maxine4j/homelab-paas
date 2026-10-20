import { start } from "./start.ts";
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
	.on("uncaughtException", async () => {
		logger.error({ operation: "fatal" }, "Fatal process failure: uncaughtException");
		await lifecycle.shutdown();
		process.exit(1);
	})
	.on("unhandledRejection", async () => {
		logger.error({ operation: "fatal" }, "Fatal process failure: unhandledRejection");
		await lifecycle.shutdown();
		process.exit(1);
	});

const main = async () => {
	await start(lifecycle);
};

main();
