import Koa from 'koa';
import Docker from 'dockerode';
import { generate as generateShortUuid } from 'short-uuid';
import { config } from './util/config';
import { Lifecycle } from './util/lifecycle';
import { createHealthCheckRouter } from './util/healthcheck';
import { bodyParser } from '@koa/bodyparser';
import { errorMiddleware } from './util/error';
import { createReverseProxy } from './domain/ingress/reverse-proxy';
import { createDeploymentDeployTask, DeploymentDeployTask } from './domain/service/deployment/deploy-task';
import { createDeploymentRepository, DeploymentRecord } from './domain/service/deployment/repository';
import { createServiceRepository, ServiceRecord } from './domain/service/repository';
import { createDeploymentStartHandler } from './domain/service/deployment/start-handler';
import { createDeploymentRouter } from './domain/service/router';
import { createDeploymentCleanupTask } from './domain/service/deployment/cleanup-task';
import { createSqliteKeyValueStore } from './kv-store/sqlite';
import { createAuthRouter } from './domain/ingress/auth/router';
import { createRequestLogger } from './util/logger';
import { createDockerService } from './docker/service';
import { createPeriodicTaskRunner } from './task/periodic';
import { TaskRunner } from './task/types';
import { createInMemoryTaskQueue, createQueueTaskRunner } from './task/queue';
import { createNetworkSyncTask } from './domain/networking/sync-task';
import { createNetworkConnectHandler } from './domain/networking/connect-handler';
import { createStartupTaskRunner } from './task/startup';

export const start = (lifecycle: Lifecycle) => {
  const app = new Koa();

  const uuid = () => generateShortUuid();
  const now = () => new Date();

  const deploymentKvStore = createSqliteKeyValueStore<DeploymentRecord>({
    databaseFilename: '/etc/homelab-paas/deployments.db',
    tableName: 'deployments',
  });
  const deploymentRepository = createDeploymentRepository(now, deploymentKvStore);

  const serviceKvStore = createSqliteKeyValueStore<ServiceRecord>({
    databaseFilename: '/etc/homelab-paas/services.db',
    tableName: 'services',
  });
  const serviceRepository = createServiceRepository(serviceKvStore);

  const dockerService = createDockerService(() => new Docker());
  const deployTaskQueue = createInMemoryTaskQueue<DeploymentDeployTask>(uuid);
  const deploymentStartHandler = createDeploymentStartHandler(uuid, deployTaskQueue);
  const networkConnectHandler = createNetworkConnectHandler(dockerService);
  
  const tasks: TaskRunner[] = [
    createQueueTaskRunner({
      lifecycle,
      queue: deployTaskQueue,
      idleDelayMs: 5_000,
      runTask: createDeploymentDeployTask(dockerService, deploymentRepository, serviceRepository, networkConnectHandler),
    }),
    createPeriodicTaskRunner({
      lifecycle,
      periodMs: 15_000,
      runTask: createDeploymentCleanupTask(dockerService, deploymentRepository, serviceRepository),
    }),
    createStartupTaskRunner({
      runTask: createNetworkSyncTask(networkConnectHandler, serviceRepository),
    })
  ]

  tasks.forEach(task => task.start());

  app
    .use(createRequestLogger())
    .use(createAuthRouter().routes())
    .use(createReverseProxy(serviceRepository, deploymentRepository))
    .use(bodyParser())
    .use(createHealthCheckRouter().routes())
    .use(createDeploymentRouter(deploymentStartHandler).routes())
    .use(errorMiddleware)
    .use((ctx) => {
      ctx.body = `
        <html>
          <h1>paas home</h1>
        </html>
      `
    });
  const server = app.listen(config.port, () => {
    console.log(`Listening on ${config.port}`);
  });

  lifecycle.registerShutdownHandler(() => {
    server.close();
  });
};
