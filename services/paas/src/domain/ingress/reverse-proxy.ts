import http from 'http';
import { Context, Next } from 'koa';
import { logger } from '../../util/logger';
import {once} from 'node:events';
import { ServiceRepository } from '../service/repository';
import { DeploymentRecord, DeploymentRepository } from '../service/deployment/repository';
import { config } from '../../util/config';
import { AuthedUserDetails, getLoginUrl, verifyAuthCookie } from './auth/oauth';

const paasAuthorizedUsernames = new Set(config.auth.authorizedUsers);

export const createReverseProxy = (
  serviceRepository: ServiceRepository,
  deploymentRepository: DeploymentRepository,
) => {
  
  const isRequestForPaas = (hostname: string) => hostname === config.rootDomain;

  const parseServiceId = (hostname: string) => {
    const serviceId = hostname.split(`.${config.rootDomain}`).at(0);
    if (!serviceId) {
      throw new Error('Failed to parse serviceId from hostname');
    }
    return serviceId;
  }

  const getActiveDeployment = async (serviceId: string) => {
    const service = await serviceRepository.queryService(serviceId);
    if (!service?.activeDeploymentId) {
      return;
    }
    return await deploymentRepository.query(service.activeDeploymentId);
  }

  const serviceAllowsPublicIngress = (activeDeployment: DeploymentRecord | undefined) => {
    return activeDeployment?.serviceDescriptor.ingress.public ?? false;
  }

  const isUserAuthorized = ({ username }: AuthedUserDetails, activeDeployment: DeploymentRecord | undefined) => {
    const serviceAuthorizedUsernames = activeDeployment?.serviceDescriptor.ingress.authorizedUsers;

    // user must be authorized to access the paas regardless of service auth
    if (!paasAuthorizedUsernames.has(username)) {
      return false;
    }
    
    // if the service does not define a list of authorized users, then any paas user can access the service
    if (serviceAuthorizedUsernames === undefined) {
      return true;
    }

    // if the service does define a list of authorized users, only allow those users access
    return serviceAuthorizedUsernames.includes(username);
  };

  const buildAuthHeaders = (authedUserDetails: AuthedUserDetails | undefined) => {
    const headers: Record<string, string> = {};

    if (!authedUserDetails) {
      return headers;
    }

    headers['PaasAuth-Username'] = authedUserDetails.username;
    headers['PaasAuth-Name'] = authedUserDetails.name;
    headers['PaasAuth-Avatar'] = authedUserDetails.avatarUrl;
  
    if (authedUserDetails.email) {
      headers['PaasAuth-Email'] = authedUserDetails.email;
    }

    return headers;
  }

  const forwardRequest = async (args: {
    ctx: Context, 
    serviceContainer: NonNullable<DeploymentRecord['container']>,
    authedUserDetails: AuthedUserDetails | undefined,
  }) => {
    const proxyReq = http.request({
      hostname: args.serviceContainer.hostname,
      port: args.serviceContainer.port,
      path: args.ctx.request.url,
      method: args.ctx.request.method,
      headers: {
        ...args.ctx.request.headers,
        ...buildAuthHeaders(args.authedUserDetails),
      },
    }, (proxyRes) => {
      logger.info({ status: proxyRes.statusCode, headers: proxyRes.headers }, 'Received response from internal service');
      args.ctx.set(proxyRes.headers as Record<string, string | string[]>);
      args.ctx.status = proxyRes.statusCode ?? 502;
      proxyRes.pipe(args.ctx.res);
    });

    proxyReq.on('error', (err) => {
      args.ctx.status = 502;
      logger.error(err);
    });

    args.ctx.req.pipe(proxyReq);

    await once(proxyReq, 'finish');
  };

  return async (ctx: Context, next: Next) => {
    
    if (isRequestForPaas(ctx.hostname)) {
      await next();
      return;
    }

    // bypass koa's built in response handling so we can pipe the response from the internal service
    ctx.respond = false;
    const serviceId = parseServiceId(ctx.hostname);
    const activeDeployment = await getActiveDeployment(serviceId);
    const authedUserDetails = await verifyAuthCookie(ctx.cookies);

    logger.info({ 
      serviceId, 
      deploymentId: activeDeployment?.deploymentId, 
      authedUserDetails,
      allowsPublicIngress: serviceAllowsPublicIngress(activeDeployment),
    }, 'Proxying request');

    if (!serviceAllowsPublicIngress(activeDeployment)) {
      if (!authedUserDetails) {
        logger.info('User not authenticated, redirecting to login url');
        ctx.redirect(getLoginUrl(ctx.request.href));
        ctx.res.end();
        return;
      }
      if (!isUserAuthorized(authedUserDetails, activeDeployment)) {
        logger.info({ authedUserDetails }, 'User not authorized');
        ctx.status = 403;
        ctx.res.end();
        return;
      }
    }

    if (!activeDeployment?.container) {
      logger.error({ serviceId }, 'Could not find active deployment for service')
      ctx.status = 503;
      ctx.res.end();
      return;
    }

    logger.info({ serviceId, deploymentId: activeDeployment?.deploymentId, authedUserDetails }, 'Forwarding request to service');
    await forwardRequest({
      ctx,
      authedUserDetails,
      serviceContainer: activeDeployment.container,
    });
  }
};
