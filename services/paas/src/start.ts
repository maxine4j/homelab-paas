import Koa from 'koa';
import koaPino from 'koa-pino-logger';
import Docker from 'dockerode';
import { generate as generateShortUuid } from 'short-uuid';
import { config } from './util/config';
import { Lifecycle } from './util/lifecycle';
import { createHealthCheckRouter } from './util/healthcheck';
import { bodyParser } from '@koa/bodyparser';
import { errorMiddleware } from './util/error';
import { createReverseProxy } from './domain/ingress/reverse-proxy';
import { createInMemoryTaskQueue } from './tasks/queue';
import { createDeploymentDeployTask, DeploymentDeployTask } from './domain/deployment/deploy-task';
import { createInMemoryDeploymentRepository } from './domain/deployment/repository';
import { createInMemoryServiceRepository } from './domain/service/repository';
import { createStartDeploymentHandler } from './domain/deployment/start-deployment-handler';
import { createDeploymentRouter } from './domain/deployment/router';
import { createDeploymentCleanupTask } from './domain/deployment/cleanup-task';
import { createCreateServiceHandler } from './domain/service/create-service-handler';

export const start = (lifecycle: Lifecycle) => {
  const app = new Koa();

  const docker = new Docker();
  const connectDocker = () => docker;
  const uuid = () => generateShortUuid();
  const now = () => new Date();


  const deployTaskQueue = createInMemoryTaskQueue<DeploymentDeployTask>(uuid);
  const startDeploymentHandler = createStartDeploymentHandler(uuid, deployTaskQueue);
  const deploymentRepository = createInMemoryDeploymentRepository(now);
  const serviceRepository = createInMemoryServiceRepository();
  const createServiceHandler = createCreateServiceHandler(connectDocker, serviceRepository);
  const startDeploymentDeployTask = createDeploymentDeployTask(lifecycle, deployTaskQueue, connectDocker, deploymentRepository, serviceRepository, createServiceHandler);
  const startDeploymentCleanupTask = createDeploymentCleanupTask(lifecycle, connectDocker, deploymentRepository, serviceRepository); 

  startDeploymentDeployTask();
  startDeploymentCleanupTask();

  app
    .use(koaPino())
    .use(createReverseProxy(serviceRepository, deploymentRepository))
    .use(bodyParser())
    .use(createHealthCheckRouter().routes())
    .use(createDeploymentRouter(startDeploymentHandler).routes())
    .use(errorMiddleware);

  const server = app.listen(config.port, () => {
    console.log(`Listening on ${config.port}`);
  });

  lifecycle.registerShutdownHandler(() => {
    server.close();
  });
};
