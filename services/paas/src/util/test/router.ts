import Koa, { Middleware } from 'koa';
import koaPino from 'koa-pino-logger';
import { bodyParser } from '@koa/bodyparser';
import { errorMiddleware } from '../error';
import Router from '@koa/router';

export const startTestApi = (router: Router) => {
  const app = new Koa();

  app
    .use(bodyParser())
    .use(koaPino())
    .use(router.routes())
    .use(errorMiddleware);

  return app.listen();
};

export const startMiddlewareTestApi = (...middlewares: Middleware[]) => {
  const app = new Koa();

  middlewares.map(middleware => app.use(middleware));

  return app.listen();
};
