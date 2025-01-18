import { logger } from '../../util/logger';
import { DockerService } from '../../docker/service';
import { ConfigService } from '../../util/config';

export class NetworkService {
  constructor(
    private readonly dockerService: DockerService,
    private readonly configService: ConfigService,
  ) {}

  public async connectServiceNetworkToPaas(serviceId: string) {
    const networkId =
      (await this.dockerService.findNetwork({ serviceId })) ??
      (await this.dockerService.createNetwork({ serviceId }));

    try {
      await this.dockerService.connectNetwork({
        containerId: this.configService.getPaasContainerHostname(),
        networkId,
      });
      logger.info({ serviceId }, 'Connected service network to paas');
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes('already exists in network')
      ) {
        logger.info({ serviceId }, 'Service network already connected to paas');
      } else {
        throw err;
      }
    }
  }
}
