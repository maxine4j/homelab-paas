import { DeploymentRepository } from './repository'
import { ServiceRepository } from '../repository'
import { logger } from '../../../util/logger'
import { DockerService } from '../../../docker/service';
import { PeriodicTask } from '../../../task/periodic';

export const createDeploymentCleanupTask = (
  dockerService: DockerService,
  deploymentRepository: DeploymentRepository,
  serviceRepository: ServiceRepository,
): PeriodicTask => {

  const shouldCleanupContainer = (
    container: { 
      serviceId?: string, 
      deploymentId?: string, 
    },
    protectedDeploymentIds: Set<string>,
  ) => {
    if (container.serviceId === undefined || container.deploymentId === undefined) {
      return true;
    }
    if (protectedDeploymentIds.has(container.deploymentId)) {
      return false;
    }
    return true;
  }

  return async () => {
    logger.info('Starting deployment cleanup task');
    
    const services = await serviceRepository.queryAllServices();
    const activeDeploymentIds = services
      .map(service => service.activeDeploymentId)
      .filter((deploymentId) => deploymentId !== undefined);

    const deployingDeployments = await deploymentRepository.queryByStatus('deploying');
    const deployingDeploymentIds = deployingDeployments.map(deployment => deployment.deploymentId);

    const protectedDeploymentIds = new Set([
      ...activeDeploymentIds,
      ...deployingDeploymentIds,
    ]);

    const containers = await dockerService.findAllContainers();
    const containersToBeCleanedUp = containers
      .filter(container => shouldCleanupContainer(container, protectedDeploymentIds));
    
    if (containersToBeCleanedUp.length === 0) {
      logger.info('No stale containers found');
      return;
    }

    logger.info({ containerIds: containersToBeCleanedUp }, 'Found containers to clean up');
    await Promise.all(containersToBeCleanedUp.map(async ({ containerId, deploymentId }) => {
      await dockerService.terminateContainer(containerId);
      if (deploymentId) {
        await deploymentRepository.markDeploymentCleanedUp(deploymentId);
      }
    }));
    logger.info({ containerIds: containersToBeCleanedUp }, 'Cleaned up containers');
  };
};
