import http from 'http';
import { Context, Next } from 'koa';
import { ServiceRegistry } from '../service/registry/registry';
import { logger } from '../../util/logger';
import {once} from 'node:events';

export const createReverseProxy = (
  serviceRegistry: ServiceRegistry,
) => {

  return async (ctx: Context, next: Next) => {
    // dont proxy requests to the paas
    const serviceId = ctx.hostname.split('.').at(0);
    if (serviceId === 'paas') {
      return next();
    }

    // bypass koa's built in response handling so we can pipe the response from the internal service
    ctx.respond = false;

    // fetch container hostname for the active deployment of the service
    if (!serviceId) {
      throw new Error('Failed to parse serviceId from hostname');
    }
    const activeDeployment = await serviceRegistry.getActiveDeployment(serviceId);
    if (!activeDeployment) {
      logger.error({ serviceId }, 'could not find an active deployment id')
      ctx.status = 503;
      return;
    }

    // forward the request to the internal service
    const proxyReq = http.request({
      hostname: activeDeployment.container.hostname,
      port: activeDeployment.container.port,
      path: ctx.request.url,
      method: ctx.request.method,
      headers: {
        ...ctx.request.headers,
        // TODO: pass through headers for logged in user here
        // 'X-Authorized-User': '...',
        // 'X-Authorized-Email': '...',
      },
    }, (proxyRes) => {
      logger.info({ status: proxyRes.statusCode, headers: proxyRes.headers }, 'Received response from internal service');
      ctx.set(proxyRes.headers as Record<string, string | string[]>);
      ctx.status = proxyRes.statusCode ?? 502;
      // pipe response back to client
      proxyRes.pipe(ctx.res);
    });

    // pipe request body to internal service
    ctx.req.pipe(proxyReq);

    proxyReq.on('error', (err) => {
      ctx.status = 502;
      logger.error(err);
    });

    await once(proxyReq, 'finish');
  }
};
