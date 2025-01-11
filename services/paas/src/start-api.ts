import Koa from 'koa';
import koaPino from 'koa-pino-logger';
import { config } from './util/config';
import { Lifecycle } from './util/lifecycle';
import { createHealthCheckRouter } from './util/healthcheck';
import { bodyParser } from '@koa/bodyparser';
import { errorMiddleware } from './util/error';

export const startApi = (lifecycle: Lifecycle) => {
  const app = new Koa();

  app
    .use(errorMiddleware)
    .use(bodyParser())
    .use(createHealthCheckRouter().routes())
    .use(koaPino())

  const server = app.listen(config.port, () => {
    console.log(`Listening on ${config.port}`);
  });

  lifecycle.registerShutdownHandler(() => {
    server.close();
  });
};
