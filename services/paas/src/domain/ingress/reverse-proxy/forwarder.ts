import http from 'node:http';
import { Context } from 'koa';
import { DeploymentRecord } from '../../service/deployment/repository';
import { once } from 'node:events';
import { logger } from '../../../util/logger';
import { AuthedUserDetails } from '../auth/oauth-provider/types';

export interface RequestForwarder {
  (args: {
    ctx: Context,
    serviceContainer: NonNullable<DeploymentRecord['container']>,
    authedUserDetails: AuthedUserDetails | undefined,
  }): Promise<void>
}

export const createRequestForwarder = (): RequestForwarder => 
  async ({ ctx, serviceContainer, authedUserDetails }) => {
    ctx.respond = false; // turn off koa's default response behavior as it returns before internal request finishes

    logger.info({ serviceContainer, authedUserDetails }, 'Forwarding request to service');
   
    const proxyReq = http.request({
      hostname: serviceContainer.hostname,
      port: serviceContainer.port,
      path: ctx.request.url,
      method: ctx.request.method,
      headers: {
        ...ctx.request.headers,
        ...buildAuthHeaders(authedUserDetails),
      },
    }, (proxyRes) => {
      logger.info({ status: proxyRes.statusCode, headers: proxyRes.headers }, 'Received response from internal service');
      ctx.set(proxyRes.headers as Record<string, string | string[]>);
      ctx.status = proxyRes.statusCode ?? 502;
      proxyRes.pipe(ctx.res);
    });

    proxyReq.on('error', (err) => {
      ctx.status = 502;
      logger.error(err);
    });

    ctx.req.pipe(proxyReq);

    await once(proxyReq, 'finish');
  };

const buildAuthHeaders = (authedUserDetails: AuthedUserDetails | undefined) => {
  const headers: Record<string, string> = {};

  if (!authedUserDetails) {
    return headers;
  }

  headers['PaasAuth-UserId'] = authedUserDetails.userId;

  if (authedUserDetails.name) {
    headers['PaasAuth-Name'] = authedUserDetails.name;
  }
  if (authedUserDetails.avatarUrl) {
    headers['PaasAuth-Avatar'] = authedUserDetails.avatarUrl;
  }
  if (authedUserDetails.email) {
    headers['PaasAuth-Email'] = authedUserDetails.email;
  }

  return headers;
};
