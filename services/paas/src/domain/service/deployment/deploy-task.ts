import { QueueTask } from '../../../task/queue'
import { DeploymentRepository } from './repository'
import { ServiceDescriptor } from '../service-descriptor'
import { DomainError } from '../../../util/error'
import { logger } from '../../../util/logger'
import { sleep } from '../../../util/sleep'
import { ServiceRepository } from '../repository'
import { ServiceConnectNetworkHandler } from '../connect-handler'
import { DockerService } from '../../../docker/service'

export interface DeploymentDeployTask {
  serviceId: string
  deploymentId: string,
  serviceDescriptor: ServiceDescriptor,
}

export const createDeploymentDeployTask = (
  dockerService: DockerService,
  deploymentRepository: DeploymentRepository,
  serviceRepository: ServiceRepository,
  connectService: ServiceConnectNetworkHandler,
  waitConfig = { maxAttempts: 5, delayMs: 5_000 },
): QueueTask<DeploymentDeployTask> => {

  const createServiceIfNotExists = async (serviceId: string) => {
    const service = await serviceRepository.queryService(serviceId);
    if (!service) {
      await serviceRepository.createService(serviceId);
    }
  }

  const waitForRunningContainer = async (serviceId: string, deploymentId: string): Promise<{ outcome: 'running' | 'failed' }> => {
    let attempt = 1;

    while (attempt <= waitConfig.maxAttempts) {
      if (await dockerService.isContainerRunning({ serviceId, deploymentId })) {
        return { outcome: 'running' };
      }
      attempt++;
      await sleep(waitConfig.delayMs);
    }

    return { 'outcome': 'failed' };
  };

  return async ({
    taskId,
    task: {
      serviceId,
      deploymentId,
      serviceDescriptor,
    },
  }) => {
    const baseLogContext = { taskId, serviceId, deploymentId }
    logger.info(baseLogContext, 'Starting deploy task');

    await createServiceIfNotExists(serviceId);
    
    await connectService(serviceId);

    await dockerService.pullImageIfNotPresent(serviceDescriptor.image);

    await deploymentRepository.createDeployment(deploymentId, serviceDescriptor);
    logger.info(baseLogContext, 'Created new deployment');

    const networkId = await dockerService.findNetwork({ serviceId });
    if (!networkId) {
      throw new DomainError('Failed to find service network', baseLogContext);
    }
    logger.info(baseLogContext, 'Found service network');

    const { hostname } = await dockerService.runContainer({ serviceId, deploymentId, image: serviceDescriptor.image, networkId });
    logger.info(baseLogContext, 'Created and started container');

    const { outcome } = await waitForRunningContainer(serviceId, deploymentId);
    switch (outcome) {
      case 'failed': {
        await deploymentRepository.markDeploymentFailed(deploymentId, 'Container failed to start');
        break;
      }
      case 'running': {
        await deploymentRepository.markDeploymentRunning(deploymentId, {
          hostname,
          port: serviceDescriptor.ingress.containerPort,
        });
  
        await serviceRepository.setActiveDeployment(serviceId, deploymentId);
        logger.info(baseLogContext, 'Deployment complete');
      }
    }
  };
};
