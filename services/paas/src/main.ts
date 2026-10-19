import { start } from "./start.ts";
import { createLifecycle } from "./util/lifecycle.ts";
import { logger } from "./util/logger.ts";

const lifecycle = createLifecycle();

process
	.on("SIGTERM", async () => {
		logger.info({}, "Recieved SIGTERM, shutting down...");
		await lifecycle.shutdown();
		process.exit(0);
	})
	.on("SIGINT", async () => {
		logger.info({}, "Recieved SIGINT, shutting down...");
		await lifecycle.shutdown();
		process.exit(0);
	})
	.on("uncaughtException", async (error) => {
		logger.error({ operation: "fatal", error }, "Fatal process failure: uncaughtException");
		await lifecycle.shutdown();
		process.exit(1);
	})
	.on("unhandledRejection", async (error) => {
		logger.error({ operation: "fatal", error }, "Fatal process failure: unhandledRejection");
		await lifecycle.shutdown();
		process.exit(1);
	});

const main = async () => {
	await start(lifecycle);
};

main();
