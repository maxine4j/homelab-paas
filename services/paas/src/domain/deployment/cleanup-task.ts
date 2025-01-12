import Docker from 'dockerode'
import { Lifecycle } from '../../util/lifecycle'
import { DeploymentRepository } from './repository'
import { ServiceRepository } from '../service/repository'
import { createPeriodicTaskRunner } from '../../tasks/periodic-runner'
import { logger } from '../../util/logger'

export const createDeploymentCleanupTask = (
  lifecycle: Lifecycle,
  connectDocker: () => Docker,
  deploymentRepository: DeploymentRepository,
  serviceRepository: ServiceRepository,
) => {

  const docker = connectDocker();

  const queryRunningContainers = async () => {
    return await docker.listContainers({
      filters: {
        label: [
          'managed-by=homelab-paas',
        ]
      }
    });
  };

  const shouldCleanupContainer = (
    protectedDeploymentIds: Set<string>, 
    containerInfo: Docker.ContainerInfo
  ) => {
    const deploymentId = containerInfo.Labels['deployment-id'] ?? undefined;
    
    if (protectedDeploymentIds.has(deploymentId)) {
      return false;
    }

    return true;
  }

  const cleanupContainer = async (containerId: string) => {
    const inactiveContainer = docker.getContainer(containerId);
    await inactiveContainer.stop();
    await inactiveContainer.remove();
  }

  return createPeriodicTaskRunner({
    lifecycle,
    periodMs: 15_000,
    runTask: async () => {
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
  
      const containerInfos = await queryRunningContainers();
      const containersIdsToBeCleanedUp = containerInfos.filter(containerInfo => 
        shouldCleanupContainer(protectedDeploymentIds, containerInfo))
        .map(containerInfo => containerInfo.Id);
  
      if (containersIdsToBeCleanedUp.length === 0) {
        logger.info('No stale containers found');
        return;
      }
  
      logger.info({ containerIds: containersIdsToBeCleanedUp }, 'Found containers to clean up');
      await Promise.all(containersIdsToBeCleanedUp.map(cleanupContainer));
      logger.info({ containerIds: containersIdsToBeCleanedUp }, 'Cleaned up containers');
    },
  });
};
