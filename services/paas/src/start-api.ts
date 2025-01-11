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
import { createInMemoryServiceRegistry } from './domain/service/registry';

export const startApi = (lifecycle: Lifecycle) => {
  const app = new Koa();

  const docker = new Docker();

  const uuid = () => generateShortUuid();
  const serviceRegistry = createInMemoryServiceRegistry();
  const deployHandler = createDeployCommandHandler(() => docker, uuid, serviceRegistry);
  const queryServiceState = createServiceStateQueryHandler(() => docker);

  app
    .use(errorMiddleware)
    .use(bodyParser())
    .use(createHealthCheckRouter().routes())
    .use(koaPino())
    .use(createServiceRouter(deployHandler, queryServiceState).routes())

  const server = app.listen(config.port, () => {
    console.log(`Listening on ${config.port}`);
  });

  lifecycle.registerShutdownHandler(() => {
    server.close();
  });
};
