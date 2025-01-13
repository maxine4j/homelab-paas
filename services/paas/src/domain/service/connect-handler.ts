import Docker from 'dockerode';
import { ServiceRepository } from './repository';
import { logger } from '../../util/logger';
import { config } from '../../util/config';

export interface ServiceConnectHandler {
  (serviceId: string): Promise<void>
}

export const createServiceConnectHandler = (
  connectDocker: () => Docker,
): ServiceConnectHandler => {

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
    const network = await docker.createNetwork({
      Name: `homelab-paas-${serviceId}`,
      Labels: {
        'managed-by': 'homelab-paas',
        'service-id': serviceId,
      }
    });
    logger.info({ serviceId }, 'Created service network');
    return network;
  }

  return async (serviceId) => {
    const existingNetworkInfo = await tryFindExistingNetwork(serviceId);
    const network = existingNetworkInfo !== undefined
      ? docker.getNetwork(existingNetworkInfo.Id)
      : await createServiceNetwork(serviceId);

    await network.connect({
      Container: config.paasContainerName,
    });
    logger.info({ serviceId }, 'Connected service network to paas');
  }
}