import { logger } from '../../util/logger';
import { config } from '../../util/config';
import { DockerService } from '../../docker/service';

export interface ServiceConnectNetworkHandler {
  (serviceId: string): Promise<void>
}

export const createServiceConnectNetworkHandler = (
  dockerService: DockerService,
): ServiceConnectNetworkHandler => {

  return async (serviceId) => {
    const networkId = await dockerService.findNetwork({ serviceId })
      ?? await dockerService.createNetwork({ serviceId });

    try {
      await dockerService.connectNetwork({
        containerName: config.paasContainerName,
        networkId,
      });
      logger.info({ serviceId }, 'Connected service network to paas');
    } catch (err) {
      if (err instanceof Error && err.message.includes('already exists in network')) {
        logger.info({ serviceId }, 'Service network already connected to paas');
      } else {
        throw err;
      }
    }
  }
}
