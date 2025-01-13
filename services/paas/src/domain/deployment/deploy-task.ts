import Docker from 'dockerode'
import { TaskQueue } from '../../task/queue'
import { createQueueTaskRunner } from '../../task/queue-runner'
import { Lifecycle } from '../../util/lifecycle'
import { DeploymentRepository } from './repository'
import { ServiceDescriptor } from '../service/service-descriptor'
import { DomainError } from '../../util/error'
import { logger } from '../../util/logger'
import { sleep } from '../../util/sleep'
import { ServiceRepository } from '../service/repository'
import { ServiceConnectHandler } from '../service/connect-handler'

export interface DeploymentDeployTask {
  serviceId: string
  deploymentId: string,
  serviceDescriptor: ServiceDescriptor,
}

export const createDeploymentDeployTask = (
  lifecycle: Lifecycle,
  queue: TaskQueue<DeploymentDeployTask>,
  connectDocker: () => Docker,
  deploymentRepository: DeploymentRepository,
  serviceRepository: ServiceRepository,
  connectService: ServiceConnectHandler,
) => {

  const docker = connectDocker();

  const formatContainerHostname = (serviceId: string, deploymentId: string) => `${serviceId}-${deploymentId}`;

  const createServiceIfNotExists = async (serviceId: string) => {
    const service = await serviceRepository.queryService(serviceId);
    if (!service) {
      await serviceRepository.createService(serviceId);
    }
  }

  const pullImageIfNotPresent = async (image: string) => {
    const existingImage = await docker.getImage(image).inspect();
    if (existingImage) {
      logger.info({ image }, 'Image already exists')
      return;
    }

    logger.info({ image }, 'Image does not exist, pulling');
    await docker.pull(image);
  }

  const findServiceNetworkId = async (serviceId: string) => {
    const networkInfos = await docker.listNetworks({
      filters: {
        label: [
          'managed-by=homelab-paas',
          `service-id=${serviceId}`,
        ]
      }
    });
    const networkInfo = networkInfos.at(0);
    if (!networkInfo) {
      throw new DomainError('Failed to deploy service: Service network does not exist', { serviceId });
    }
    return networkInfo.Id;
  }

  const startContainer = async (serviceId: string, deploymentId: string, image: string, networkId: string) => {
    const container = await docker.createContainer({
      Image: image,
      name: formatContainerHostname(serviceId, deploymentId),
      Labels: {
        'managed-by': 'homelab-paas',
        'service-id': serviceId,
        'deployment-id': deploymentId,
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [networkId]: {
            NetworkID: networkId,
          },
        },
      }
    });
    await container.start();
  }

  const isContainerRunning = async (serviceId: string, deploymentId: string) => {
    const containerInfos = await docker.listContainers({
      filters: {
        label: [
          'managed-by=homelab-paas',
          `service-id=${serviceId}`,
          `deployment-id=${deploymentId}`,
        ],
      }
    });
    
    if (containerInfos.at(0)?.State !== 'running') {
      return false;
    }

    return true;
  }

  const waitForRunningContainer = async (serviceId: string, deploymentId: string) => {
    let attempt = 1;
    const maxAttempts = 5;
    const delayMs = 1_000;

    while (attempt <= maxAttempts) {
      if (await isContainerRunning(serviceId, deploymentId)) {
        return
      }
      attempt++;
      await sleep(delayMs);
    }

    throw new DomainError(`Container failed to start after ${maxAttempts} attempts`, { attempt, delayMs });
  };

  return createQueueTaskRunner<DeploymentDeployTask>({
    lifecycle,
    queue,
    idleDelayMs: 5_000,
    runTask: async ({
      taskId,
      task: {
        serviceId,
        deploymentId,
        serviceDescriptor,
      },
    }) => {
      logger.info({ taskId, serviceId, deploymentId }, 'Starting deploy task');

      await createServiceIfNotExists(serviceId);
      
      await connectService(serviceId);

      await pullImageIfNotPresent(serviceDescriptor.image);
  
      await deploymentRepository.createDeployment(deploymentId, serviceDescriptor);
      logger.info({ taskId, serviceId, deploymentId }, 'Created new deployment');
  
      const networkId = await findServiceNetworkId(serviceId);
      logger.info({ taskId, serviceId, deploymentId }, 'Found service network');

      await startContainer(serviceId, deploymentId, serviceDescriptor.image, networkId);
      logger.info({ taskId, serviceId, deploymentId }, 'Created and started container');
  
      await waitForRunningContainer(serviceId, deploymentId);
  
      await deploymentRepository.markDeploymentRunning(deploymentId, {
        hostname: formatContainerHostname(serviceId, deploymentId),
        port: serviceDescriptor.containerPort ?? 8080,
      });

      await serviceRepository.setActiveDeployment(serviceId, deploymentId);
      logger.info({ taskId, serviceId, deploymentId }, 'Deployment complete');
    },
  });
};
