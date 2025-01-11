import Docker from 'dockerode';
import { logger } from '../../../util/logger';
import { ContainerState, ServiceState } from './types';

export interface ServiceStateQueryHandler {
  (serviceId: string): Promise<ServiceState>
}

export const createServiceStateQueryHandler = (
  connectDocker: () => Docker,
): ServiceStateQueryHandler => {
  const docker = connectDocker();

  return async (serviceId) => {

    const containers = await docker.listContainers({
      filters: {
        label: [
          'managed-by=homelab-pass',
          `service-id=${serviceId}`,
        ],
      }
    });

    // TODO: support multiple containers and detecting old deployment ids
    const serviceContainer = containers.at(0);
    if (!serviceContainer) {
      return {
        serviceId,
        containerState: { state: 'missing' }
      };
    }

    logger.info({ serviceContainer }, 'Found service container');

    return {
      serviceId,
      containerState: {
        name: serviceContainer.Names[0],
        createdAt: new Date(serviceContainer.Created * 1_000),
        image: serviceContainer.Image,
        state: mapContainerState(serviceContainer.State),
      }
    } as any
  }
}

const mapContainerState = (apiStateResponse: string): ContainerState['state'] => {
  switch (apiStateResponse) {
    case 'created':
    case 'restarting':
        return 'pending';
    case 'running': 
      return 'healthy';
    case 'paused':
      return 'unhealthy';
    case 'exited':
    case 'dead':
    default:
      return 'error';
  }
}