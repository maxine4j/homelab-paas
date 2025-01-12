import Docker from 'dockerode';
import { ServiceRepository } from './repository';
import { logger } from '../../util/logger';

export interface CreateServiceHandler {
  (serviceId: string): Promise<void>
}

export const createServiceCreateHandler = (
  connectDocker: () => Docker,
  serviceRepository: ServiceRepository,
): CreateServiceHandler => {

  const docker = connectDocker();

  const tryFindExistingNetwork = async (serviceId: string) => {
    const existingNetworkInfos = await docker.listNetworks({
      filters: {
        label: [
          'managed-by=homelab-paas',
          `service-id=${serviceId}`,
        ]
      }
    });
    return existingNetworkInfos.at(0);
  }

  const createServiceNetwork = async (serviceId: string) => {
    return await docker.createNetwork({
      Name: `homelab-paas-${serviceId}`,
      Labels: {
        'managed-by': 'homelab-paas',
        'service-id': serviceId,
      }
    });
  }

  return async (serviceId) => {
    const existingNetworkInfo = await tryFindExistingNetwork(serviceId);
    const network = existingNetworkInfo !== undefined
      ? docker.getNetwork(existingNetworkInfo.Id)
      : await createServiceNetwork(serviceId);
    logger.info('Created network for new service');

    await network.connect({
      Container: '/homelab-paas-1',
    });
    logger.info('Connected network to paas');

    await serviceRepository.createService(serviceId);
    logger.info('Created service');
  }
}