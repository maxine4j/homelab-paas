import { Context, Middleware, Next } from 'koa';
import { logger } from '../../../util/logger';
import { ServiceRepository } from '../../service/repository';
import { DeploymentRecord, DeploymentRepository } from '../../service/deployment/repository';
import { UserAuthorizationChecker } from '../auth/authz';
import { RequestForwarder } from './forward';
import { AuthenticatedUserGetter } from '../auth/authn';

export const createReverseProxyMiddleware = (
  serviceRepository: ServiceRepository,
  deploymentRepository: DeploymentRepository,
  getAuthenticatedUser: AuthenticatedUserGetter,
  isAuthorized: UserAuthorizationChecker,
  forwardRequest: RequestForwarder,
  rootDomain: string,
  getLoginUrl: (redirect: string) => string,
): Middleware => {
  
  const isRequestForPaas = (hostname: string) => hostname === rootDomain;

  const parseServiceId = (hostname: string) => {
    const serviceId = hostname.split(`.${rootDomain}`).at(0);
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
    return activeDeployment?.serviceDescriptor?.ingress?.public ?? false;
  }

  return async (ctx: Context, next: Next) => {
    
    if (isRequestForPaas(ctx.hostname)) {
      logger.info('request is for paas')
      await next();
      return;
    }

    // bypass koa's built in response handling so we can pipe the response from the internal service
    const serviceId = parseServiceId(ctx.hostname);
    const activeDeployment = await getActiveDeployment(serviceId);
    const authedUserDetails = await getAuthenticatedUser(ctx.cookies);

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
        // ctx.res.end();
        return;
      }
      if (!isAuthorized(
        authedUserDetails.username, 
        activeDeployment?.serviceDescriptor?.ingress?.authorizedUsers)
      ) {
        logger.info({ authedUserDetails }, 'User not authorized');
        ctx.status = 403;
        // ctx.res.end();
        return;
      }
    }

    if (!activeDeployment?.container) {
      logger.error({ serviceId }, 'Could not find active deployment for service')
      ctx.status = 503;
      // ctx.res.end();
      return;
    }

    await forwardRequest({
      ctx,
      authedUserDetails,
      serviceContainer: activeDeployment.container,
    });
  }
};
