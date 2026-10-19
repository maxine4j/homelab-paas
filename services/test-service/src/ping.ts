import Router from '@koa/router';
import { logger } from './logger';

interface PingRequesetBody {
  targetServiceId: string,
  message: string,
}

export const createPingRouter = () => {
  return new Router()
    .get('/ping', async (ctx) => {
      const message = ctx.request.query['message'];
      logger.info({ message }, 'Received ping');
      ctx.status = 200;
      ctx.body = {
        message: 'pong',
      };
    })
    .post('/ping', async (ctx) => {
      const { targetServiceId, message } = ctx.request.body as PingRequesetBody;

      const url = `http://${targetServiceId}.mesh:9090/ping?message=${encodeURIComponent(message)}`;

      logger.info({ url, message, targetServiceId }, 'Sending ping');
      const response = await fetch(url);

      ctx.status = 200;
      ctx.body = await response.json();
    });
};
