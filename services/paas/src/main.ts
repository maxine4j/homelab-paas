import { start } from './start';
import { createLifecycle } from './util/lifecycle';
import { logger } from './util/logger';

const lifecycle = createLifecycle();

process
  .on('SIGTERM', async () => {
    await lifecycle.shutdown();
    process.exit(0);
  })
  .on('SIGINT', async () => {
    await lifecycle.shutdown();
    process.exit(0);
  })
  .on('uncaughtException', async (error) => {
    logger.error(error);
    await lifecycle.shutdown();
    process.exit(1);
  })
  .on('unhandledRejection', async (error) => {
    logger.error(error);
    await lifecycle.shutdown();
    process.exit(1);
  });

const main = async () => {
  start(lifecycle);
};

main();
