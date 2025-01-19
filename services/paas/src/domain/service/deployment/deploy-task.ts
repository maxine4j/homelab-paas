import { DockerService } from '../../../docker/service';
import { QueueTask, TaskEnvelope } from '../../../task/queue';
import { DomainError } from '../../../util/error';
import { logger } from '../../../util/logger';
import { sleep } from '../../../util/sleep';
import { NetworkService } from '../../network/service';
import { ServiceRepository } from '../repository';
import { ServiceDescriptor } from '../service-descriptor';
import { DeploymentRepository } from './repository';

export interface DeployTaskDescriptor {
  serviceId: string;
  deploymentId: string;
  serviceDescriptor: ServiceDescriptor;
}

export class DeployTask implements QueueTask<DeployTaskDescriptor> {
  constructor(
    private readonly dockerService: DockerService,
    private readonly deploymentRepository: DeploymentRepository,
    private readonly serviceRepository: ServiceRepository,
    private readonly networkService: NetworkService,
    private readonly waitConfig = { maxAttempts: 5, delayMs: 5_000 },
  ) {}

  private async createServiceIfNotExists(serviceId: string) {
    const service = await this.serviceRepository.queryService(serviceId);
    if (!service) {
      await this.serviceRepository.createService(serviceId);
    }
  }

  private async waitForRunningContainer(
    serviceId: string,
    deploymentId: string,
  ): Promise<{ outcome: 'running' | 'failed' }> {
    let attempt = 1;

    while (attempt <= this.waitConfig.maxAttempts) {
      if (
        await this.dockerService.isContainerRunning({
          serviceId,
          deploymentId,
        })
      ) {
        return { outcome: 'running' };
      }
      attempt++;
      await sleep(this.waitConfig.delayMs);
    }

    return { outcome: 'failed' };
  }

  public async run({
    taskId,
    task: { serviceId, deploymentId, serviceDescriptor },
  }: TaskEnvelope<DeployTaskDescriptor>) {
    const baseLogContext = { taskId, serviceId, deploymentId };
    logger.info(baseLogContext, 'Starting deploy task');

    await this.createServiceIfNotExists(serviceId);

    await this.dockerService.pullImageIfNotPresent(serviceDescriptor.image);

    await this.deploymentRepository.createDeployment(
      deploymentId,
      serviceDescriptor,
    );
    logger.info(baseLogContext, 'Created new deployment');

    const networkId = await this.networkService.getServiceNetworkId(serviceId);
    if (!networkId) {
      throw new DomainError('Failed to find service network', baseLogContext);
    }
    logger.info(baseLogContext, 'Found service network');

    const { hostname } = await this.dockerService.runContainer({
      serviceId,
      deploymentId,
      image: serviceDescriptor.image,
      networkId,
      volumes: serviceDescriptor.volumes,
      environment: serviceDescriptor.environment,
    });
    logger.info(baseLogContext, 'Created and started container');

    const { outcome } = await this.waitForRunningContainer(
      serviceId,
      deploymentId,
    );

    switch (outcome) {
      case 'failed': {
        await this.deploymentRepository.markDeploymentFailed(
          deploymentId,
          'Container failed to start',
        );
        break;
      }
      case 'running': {
        await this.networkService.configureServiceNetwork(serviceId);

        await this.deploymentRepository.markDeploymentRunning(deploymentId, {
          hostname,
          port: serviceDescriptor.ingress.containerPort,
        });

        await this.serviceRepository.setActiveDeployment(
          serviceId,
          deploymentId,
        );
        logger.info(baseLogContext, 'Deployment complete');
      }
    }
  }
}
