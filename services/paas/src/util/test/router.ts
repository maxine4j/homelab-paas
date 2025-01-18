import { bodyParser } from '@koa/bodyparser';
import Router from '@koa/router';
import Koa, { Middleware } from 'koa';
import koaPino from 'koa-pino-logger';
import { errorMiddleware } from '../error';

export const startTestApi = (routes: ReturnType<Router['routes']>) => {
  const app = new Koa();

  app.use(bodyParser()).use(koaPino()).use(routes).use(errorMiddleware);

  return app.listen();
};

export const startMiddlewareTestApi = (...middlewares: Middleware[]) => {
  const app = new Koa();

  middlewares.map((middleware) => app.use(middleware));

  return app.listen();
};
