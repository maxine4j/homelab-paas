import Koa from 'koa';
import Docker from 'dockerode';
import { generate as generateShortUuid } from 'short-uuid';
import { config } from './util/config';
import { Lifecycle } from './util/lifecycle';
import { createHealthCheckRouter } from './util/healthcheck';
import { bodyParser } from '@koa/bodyparser';
import { errorMiddleware } from './util/error';
import { createReverseProxy } from './domain/ingress/reverse-proxy';
import { createInMemoryTaskQueue } from './task/queue';
import { createDeploymentDeployTask, DeploymentDeployTask } from './domain/deployment/deploy-task';
import { createDeploymentRepository, DeploymentRecord } from './domain/deployment/repository';
import { createServiceRepository, ServiceRecord } from './domain/service/repository';
import { createDeploymentStartHandler } from './domain/deployment/start-handler';
import { createDeploymentRouter } from './domain/deployment/router';
import { createDeploymentCleanupTask } from './domain/deployment/cleanup-task';
import { createServiceConnectHandler } from './domain/service/connect-handler';
import { createSqliteKeyValueStore } from './kv-store/sqlite';
import { createAuthRouter } from './domain/ingress/auth/router';
import { createRequestLogger } from './util/logger';

export const start = (lifecycle: Lifecycle) => {
  const app = new Koa();

  const docker = new Docker();
  const connectDocker = () => docker;
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

  const deployTaskQueue = createInMemoryTaskQueue<DeploymentDeployTask>(uuid);

  const deploymentStartHandler = createDeploymentStartHandler(uuid, deployTaskQueue);
  const serviceConnectHandler = createServiceConnectHandler(connectDocker);
  
  const startDeploymentDeployTask = createDeploymentDeployTask(lifecycle, deployTaskQueue, connectDocker, deploymentRepository, serviceRepository, serviceConnectHandler);
  const startDeploymentCleanupTask = createDeploymentCleanupTask(lifecycle, connectDocker, deploymentRepository, serviceRepository); 

  startDeploymentDeployTask();
  startDeploymentCleanupTask();

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
