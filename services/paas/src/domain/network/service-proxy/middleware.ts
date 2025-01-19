import { Context, Next } from 'koa';
import { DockerService } from '../../../docker/service';
import { logger } from '../../../util/logger';
import { RequestForwarder } from '../../../util/request-forwarder';
import {
  DeploymentRecord,
  DeploymentRepository,
} from '../../service/deployment/repository';
import { ServiceRepository } from '../../service/repository';

export const createServiceProxyMiddleware = (
  serviceRepository: ServiceRepository,
  deploymentRepository: DeploymentRepository,
  dockerService: DockerService,
  forwardRequest: RequestForwarder,
) => {
  const parseTargetServiceId = (hostname: string) => {
    return hostname.split('.mesh').at(0);
  };

  const translatePossibleIpV6Address = (ipAddress: string) => {
    const ipv6Prefix = '::ffff:';
    if (ipAddress.startsWith(ipv6Prefix)) {
      return ipAddress.substring(ipv6Prefix.length);
    }
    return ipAddress;
  };

  const lookupRequestingServiceId = async (ipAddress: string) => {
    const containers = await dockerService.findAllContainers();
    const requestingContainer = containers.find(
      (container) => container.ipAddress === ipAddress,
    );
    return requestingContainer?.serviceId;
  };

  const isCommunicationAllowed = async (
    targetDeployment: DeploymentRecord,
    requestingDeployment: DeploymentRecord,
  ) => {
    const targetIngressAllowList =
      targetDeployment?.serviceDescriptor.networking.serviceProxy?.ingress ?? [];
    const requestingEgressAllowList =
      requestingDeployment?.serviceDescriptor.networking.serviceProxy?.egress ?? [];

    return (
      targetIngressAllowList.includes(requestingDeployment.serviceId) &&
      requestingEgressAllowList.includes(targetDeployment.serviceId)
    );
  };

  return async (ctx: Context, next: Next) => {
    const targetServiceId = parseTargetServiceId(ctx.hostname);
    const requestingServiceId = await lookupRequestingServiceId(
      translatePossibleIpV6Address(ctx.request.ip),
    );

    if (!targetServiceId || !requestingServiceId) {
      logger.error(
        { targetServiceId, requestingServiceId },
        'Failed to resolve target or requesting serviceId',
      );
      ctx.status = 500;
      return;
    }

    const [targetService, requestingService] = await Promise.all([
      serviceRepository.queryService(targetServiceId),
      serviceRepository.queryService(requestingServiceId),
    ]);
    const [targetDeployment, requestingDeployment] = await Promise.all([
      deploymentRepository.query(targetService?.activeDeploymentId ?? ''),
      deploymentRepository.query(requestingService?.activeDeploymentId ?? ''),
    ]);

    if (!targetDeployment || !requestingDeployment) {
      logger.error(
        {
          targetServiceId,
          targetDeploymentId: targetService?.activeDeploymentId,
          requestingServiceId,
          requestingDeploymentId: requestingService?.activeDeploymentId,
        },
        'Failed to find target or requesting deployment',
      );
      ctx.status = 503;
      return;
    }

    if (
      !(await isCommunicationAllowed(targetDeployment, requestingDeployment))
    ) {
      logger.info(
        { targetServiceId, requestingServiceId },
        'Blocked service proxy request, requester is not allowed to communicate with target',
      );
      ctx.status = 403;
      return;
    }

    if (!targetDeployment?.container) {
      ctx.status = 503;
      return;
    }

    await forwardRequest({
      ctx,
      hostname: targetDeployment.container.hostname,
      port: targetDeployment.container.port,
    });
  };
};
