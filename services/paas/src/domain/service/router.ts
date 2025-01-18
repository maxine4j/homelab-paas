import Router, { RouterContext } from '@koa/router';
import {
  DeploymentRecord,
  DeploymentRepository,
} from './deployment/repository';
import { ServiceRepository } from './repository';

export const createServiceRouter = (
  serviceRepository: ServiceRepository,
  deploymentRepository: DeploymentRepository,
) => {
  const getServiceSummary = async (ctx: RouterContext) => {
    const serviceId = ctx.params['serviceId'];
    const serviceRecord = await serviceRepository.queryService(serviceId ?? '');
    if (!serviceId || !serviceRecord) {
      ctx.status = 404;
      return;
    }

    const deploymentRecords =
      await deploymentRepository.queryByService(serviceId);

    const recentDeployments = deploymentRecords
      .sort(byDeploymentCreatedAt)
      .slice(0, 10);

    ctx.body = {
      service: serviceRecord,
      deployments: recentDeployments,
    };
  };

  return new Router().get('/service/:serviceId/summary', getServiceSummary);
};

const byDeploymentCreatedAt = (
  deploymentA: DeploymentRecord,
  deploymentB: DeploymentRecord,
) => {
  return (
    new Date(deploymentA.createdAt).getTime() -
    new Date(deploymentB.createdAt).getTime()
  );
};
