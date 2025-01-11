import { createBootstrapEnvoyService } from './domain/ingress/bootstrap-envoy';
import { startApi } from './start-api';
import { startWorker } from './start-worker';
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

const main = async () => {
  await startWorker();
  startApi(lifecycle);
};

main();
