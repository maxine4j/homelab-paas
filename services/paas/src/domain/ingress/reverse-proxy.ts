import http from 'http';
import { Context, Next } from 'koa';
import { logger } from '../../util/logger';
import {once} from 'node:events';
import { ServiceRepository } from '../service/repository';
import { DeploymentRepository } from '../deployment/repository';
import { config } from '../../util/config';
import { getLoginUrl, isAuthCookieValid } from './auth/oauth';

export const createReverseProxy = (
  serviceRepository: ServiceRepository,
  deploymentRepository: DeploymentRepository,
) => {

  return async (ctx: Context, next: Next) => {
    // check for auth cookie
    if (!await isAuthCookieValid(ctx.cookies)) {
      logger.info({ desiredUrl: ctx.request.href }, 'auth cookie is not valid');
      return ctx.redirect(getLoginUrl(ctx.request.href));
    }

    // dont proxy requests to the paas
    if (ctx.hostname === config.rootDomain) {
      return next();
    }

    // bypass koa's built in response handling so we can pipe the response from the internal service
    ctx.respond = false;

    // fetch container hostname for the active deployment of the service
    const serviceId = ctx.hostname.split(`.${config.rootDomain}`).at(0);
    if (!serviceId) {
      throw new Error('Failed to parse serviceId from hostname');
    }
    
    const service = await serviceRepository.queryService(serviceId);
    const activeDeployment = await deploymentRepository.query(service?.activeDeploymentId ?? '')
    if (!activeDeployment || !activeDeployment.container) {
      logger.error({ serviceId }, 'Could not find active deployment for service')
      ctx.status = 503;
      ctx.res.end();
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
