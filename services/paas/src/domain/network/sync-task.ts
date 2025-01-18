import { StartupTask } from '../../task/startup';
import { logger } from '../../util/logger';
import { ServiceRepository } from '../service/repository';
import { NetworkService } from './service';

export class NetworkSyncTask implements StartupTask {
  constructor(
    private readonly networkService: NetworkService,
    private readonly serviceRepository: ServiceRepository,
  ) {}

  public async run() {
    logger.info('Starting network sync task');
    const services = await this.serviceRepository.queryAllServices();
    await Promise.all(
      services.map((service) =>
        this.networkService.connectServiceNetworkToPaas(service.serviceId),
      ),
    );
  }
}
