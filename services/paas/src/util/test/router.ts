import Koa from 'koa';
import koaPino from 'koa-pino-logger';
import { bodyParser } from '@koa/bodyparser';
import Router from '@koa/router';
import { errorMiddleware } from '../error';

export const startTestApi = (router: Router) => {
  const app = new Koa();

  app
    .use(errorMiddleware)
    .use(bodyParser())
    .use(koaPino())
    .use(router.routes());

  return app.listen();
};
