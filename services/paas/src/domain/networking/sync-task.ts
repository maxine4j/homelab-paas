import { StartupTask } from '../../task/startup';
import { logger } from '../../util/logger';
import { ServiceRepository } from '../service/repository';
import { NetworkConnectHandler } from './connect-handler';

export class NetworkSyncTask implements StartupTask {

  constructor(
    private readonly connectNetwork: NetworkConnectHandler,
    private readonly serviceRepository: ServiceRepository,
  ) {}

  public async run() {
    logger.info('Starting network sync task');
    const services = await this.serviceRepository.queryAllServices();
    await Promise.all(services.map(service => this.connectNetwork(service.serviceId)));
  };
};
