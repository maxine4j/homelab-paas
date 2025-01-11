import Docker from 'dockerode'
import { logger } from '../../util/logger';
import { ServiceDescriptor } from './service-descriptor'
import { ServiceRegistry } from './registry';
import { sleep } from '../../util/sleep';
import { ContextualError } from '../../util/error';

type ContainerState = 'running' | 'missing' | 'error';

export interface DeployCommandHandler {
  (serviceDescriptor: ServiceDescriptor): Promise<void>
}

export const createDeployCommandHandler = (
  connectDocker: () => Docker,
  generateDeploymentId: () => string,
  serviceRegistry: ServiceRegistry,
): DeployCommandHandler => {

  const docker = connectDocker();

  const formatContainerName = (serviceId: string, deploymentId: string) => `${serviceId}-${deploymentId}`;

  const formatContainerLabels = (serviceId: string, deploymentId: string) => ({
    'managed-by': 'homelab-pass',
    'service-id': serviceId,
    'deployment-id': deploymentId,
  });

  const storeDeploymentInRegistry = async (deploymentId: string, serviceDescriptor: ServiceDescriptor) => {
    const serviceRegistryRecord = await serviceRegistry.load(serviceDescriptor.serviceId) ?? {
      serviceId: serviceDescriptor.serviceId,
       deployments: [],
    };
    serviceRegistryRecord.deployments.push({
      deploymentId,
      serviceDescriptor,
    });
    await serviceRegistry.save(serviceRegistryRecord);
  }

  const startContainer = async (serviceId: string, deploymentId: string, image: string) => {
    const container = await docker.createContainer({
      Image: image,
      name: formatContainerName(serviceId, deploymentId),
      Labels: formatContainerLabels(serviceId, deploymentId),
      ExposedPorts: {
        '8080/tcp': {}
      },
      HostConfig: {
        PortBindings: {
          '8080/tcp': [{
            HostPort: '8081'
          }]
        }
      }
    });
    await container.start();
  }

  const queryContainerState = async (serviceId: string, deploymentId: string): Promise<ContainerState> => {
    const containerInfos = await docker.listContainers({
      filters: {
        label: Object.entries(formatContainerLabels(serviceId, deploymentId)).map(([key, value]) => `${key}=${value}`),
      }
    });
    const containerInfo = containerInfos.at(0);

    if (!containerInfo) {
      return 'missing';
    }

    if (containerInfo.State !== 'running') {
      return 'error';
    }

    return 'running';
  }

  const waitForRunningContainer = async (serviceId: string, deploymentId: string) => {
    let attempt = 1;
    const maxAttempts = 5;
    const delayMs = 1_000;

    while (attempt <= maxAttempts) {
      const containerState = await queryContainerState(serviceId, deploymentId);
      logger.info({ serviceId, deploymentId, attempt, containerState }, 'Queried container state');
      if (containerState === 'running') {
        return 'running';
      }
      attempt++;
      await sleep(delayMs);
    }

    throw new ContextualError(`Container failed to start after ${maxAttempts} attempts`, { attempt, delayMs });
  };

  return async (serviceDescriptor) => {
    const { serviceId } = serviceDescriptor;
    const deploymentId = generateDeploymentId();
    logger.info({ serviceId, deploymentId, serviceDescriptor }, 'Starting deployment');

    await storeDeploymentInRegistry(deploymentId, serviceDescriptor);
    logger.info({ serviceId, deploymentId }, 'Updated service registry');

    // start new containers
    await startContainer(serviceId, deploymentId, serviceDescriptor.image);
    logger.info({ serviceId, deploymentId }, 'Deployed new container');

    // wait for healthy
    await waitForRunningContainer(serviceId, deploymentId);
    logger.info({ serviceId, deploymentId }, 'Container is running');

    // update ingress

    // stop old containers
  };
};
