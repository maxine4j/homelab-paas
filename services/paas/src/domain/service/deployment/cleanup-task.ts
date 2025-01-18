import { DockerService } from '../../../docker/service';
import { PeriodicTask } from '../../../task/periodic';
import { logger } from '../../../util/logger';
import { ServiceRepository } from '../repository';
import { DeploymentRepository } from './repository';

export class DeploymentCleanupTask implements PeriodicTask {
  constructor(
    private readonly dockerService: DockerService,
    private readonly deploymentRepository: DeploymentRepository,
    private readonly serviceRepository: ServiceRepository,
  ) {}

  public async run() {
    logger.info('Starting deployment cleanup task');

    const services = await this.serviceRepository.queryAllServices();
    const activeDeploymentIds = services
      .map((service) => service.activeDeploymentId)
      .filter((deploymentId) => deploymentId !== undefined);

    const deployingDeployments =
      await this.deploymentRepository.queryByStatus('deploying');
    const deployingDeploymentIds = deployingDeployments.map(
      (deployment) => deployment.deploymentId,
    );

    const protectedDeploymentIds = new Set([
      ...activeDeploymentIds,
      ...deployingDeploymentIds,
    ]);

    const containers = await this.dockerService.findAllContainers();
    const containersToBeCleanedUp = containers.filter((container) =>
      this.shouldCleanupContainer(container, protectedDeploymentIds),
    );

    if (containersToBeCleanedUp.length === 0) {
      logger.info('No stale containers found');
      return;
    }

    logger.info(
      { containerIds: containersToBeCleanedUp },
      'Found containers to clean up',
    );
    await Promise.all(
      containersToBeCleanedUp.map(async ({ containerId, deploymentId }) => {
        await this.dockerService.terminateContainer(containerId);
        if (
          deploymentId &&
          (await this.deploymentRepository.query(deploymentId))
        ) {
          await this.deploymentRepository.markDeploymentCleanedUp(deploymentId);
        }
      }),
    );
    logger.info(
      { containerIds: containersToBeCleanedUp },
      'Cleaned up containers',
    );
  }

  private shouldCleanupContainer(
    container: {
      serviceId?: string;
      deploymentId?: string;
    },
    protectedDeploymentIds: Set<string>,
  ) {
    if (
      container.serviceId === undefined ||
      container.deploymentId === undefined
    ) {
      return true;
    }
    if (protectedDeploymentIds.has(container.deploymentId)) {
      return false;
    }
    return true;
  }
}
