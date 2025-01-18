import { Context } from 'koa';
import { once } from 'node:events';
import http from 'node:http';
import { logger } from './logger';

export interface RequestForwarder {
  (args: {
    ctx: Context;
    hostname: string;
    port: number;
    additionalHeaders?: Record<string, string>;
  }): Promise<void>;
}

export const createRequestForwarder =
  (): RequestForwarder =>
  async ({ ctx, hostname, port, additionalHeaders }) => {
    ctx.respond = false; // turn off koa's default response behavior as it returns before internal request finishes

    logger.info({ hostname, port, additionalHeaders }, 'Forwarding request');

    const proxyReq = http.request(
      {
        hostname,
        port,
        path: ctx.request.url,
        method: ctx.request.method,
        headers: {
          ...ctx.request.headers,
          ...additionalHeaders,
        },
      },
      (proxyRes) => {
        logger.info(
          { status: proxyRes.statusCode, headers: proxyRes.headers },
          'Received response from internal service',
        );
        ctx.set(proxyRes.headers as Record<string, string | string[]>);
        ctx.status = proxyRes.statusCode ?? 502;
        proxyRes.pipe(ctx.res);
      },
    );

    proxyReq.on('error', (err) => {
      ctx.status = 502;
      logger.error(err);
    });

    ctx.req.pipe(proxyReq);

    await once(proxyReq, 'finish');
  };
