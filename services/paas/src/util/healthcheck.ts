import { Context } from 'koa';
import Router from '@koa/router';

export const createHealthCheckRouter = () => {
  
  const getHealth = (ctx: Context) => {
    ctx.status = 200;
    ctx.body = {
      status: 'up',
    };
  };
  
  return new Router()
    .get('/healthz', getHealth)
    .get('/livez', getHealth)
    .get('/readyz', getHealth)
    .get('/health', getHealth);
};
