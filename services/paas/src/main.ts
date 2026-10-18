import { start } from "./start.ts";
import { createLifecycle } from "./util/lifecycle.ts";
import { createProcessLogger } from "./util/logging.ts";
const logger = createProcessLogger();

const lifecycle = createLifecycle();

process
  .on("SIGTERM", async () => {
    await lifecycle.shutdown();
    process.exit(0);
  })
  .on("SIGINT", async () => {
    await lifecycle.shutdown();
    process.exit(0);
  })
  .on("uncaughtException", async () => {
    logger.error({ operation: "fatal" }, "Fatal process failure");
    await lifecycle.shutdown();
    process.exit(1);
  })
  .on("unhandledRejection", async () => {
    logger.error({ operation: "fatal" }, "Fatal process failure");
    await lifecycle.shutdown();
    process.exit(1);
  });

const main = async () => {
  await start(lifecycle);
};

main();
