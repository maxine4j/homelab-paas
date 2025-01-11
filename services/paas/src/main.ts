import { startApi } from './start-api';
import { createLifecycle } from './util/lifecycle';

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
  .on('uncaughtException', async () => {
    await lifecycle.shutdown();
    process.exit(1);
  })
  .on('unhandledRejection', async () => {
    await lifecycle.shutdown();
    process.exit(1);
  });

const main = () => {
  startApi(lifecycle);
};

main();
