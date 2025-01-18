import { logger } from '../../util/logger';
import { config } from '../../util/config';
import { DockerService } from '../../docker/service';

export class NetworkService {

  constructor(
    private readonly dockerService: DockerService,
  ) {}

  public async connectServiceNetworkToPaas(serviceId: string) {
    const networkId = await this.dockerService.findNetwork({ serviceId })
      ?? await this.dockerService.createNetwork({ serviceId });

    try {
      await this.dockerService.connectNetwork({
        containerId: config.paasContainerId,
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
