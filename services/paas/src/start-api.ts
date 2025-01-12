import Koa from 'koa';
import koaPino from 'koa-pino-logger';
import Docker from 'dockerode';
import { generate as generateShortUuid } from 'short-uuid';
import { config } from './util/config';
import { Lifecycle } from './util/lifecycle';
import { createHealthCheckRouter } from './util/healthcheck';
import { bodyParser } from '@koa/bodyparser';
import { errorMiddleware } from './util/error';
import { createServiceRouter } from './domain/service/router';
import { createDeployCommandHandler } from './domain/service/deploy-handler';
import { createServiceStateQueryHandler } from './domain/service/state/query-state';
import { createInMemoryServiceRegistryRepository } from './domain/service/registry/repository';
import { createReverseProxy } from './domain/ingress/reverse-proxy';
import { createServiceRegistry } from './domain/service/registry/registry';
import { logger } from './util/logger';

export const startApi = (lifecycle: Lifecycle) => {
  const app = new Koa();

  const docker = new Docker();

  const uuid = () => generateShortUuid();
  const serviceRegistry = createServiceRegistry(createInMemoryServiceRegistryRepository());
  const deployHandler = createDeployCommandHandler(() => docker, uuid, serviceRegistry);
  const queryServiceState = createServiceStateQueryHandler(() => docker);

  app
    .use(koaPino())
    .use(createReverseProxy(serviceRegistry))
    .use(bodyParser())
    .use(createHealthCheckRouter().routes())
    .use(createServiceRouter(deployHandler, queryServiceState).routes())
    .use(errorMiddleware)

  const server = app.listen(config.port, () => {
    console.log(`Listening on ${config.port}`);
  });

  lifecycle.registerShutdownHandler(() => {
    server.close();
  });
};
