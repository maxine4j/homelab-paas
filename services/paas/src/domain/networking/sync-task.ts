import { StartupTask } from '../../task/startup';
import { logger } from '../../util/logger';
import { ServiceRepository } from '../service/repository';
import { NetworkConnectHandler } from './connect-handler';

export const createNetworkSyncTask = (
  connectNetwork: NetworkConnectHandler,
  serviceRepository: ServiceRepository,
): StartupTask => {

  return async () => {
    logger.info('Starting network sync task');
    const services = await serviceRepository.queryAllServices();
    await Promise.all(services.map(service => connectNetwork(service.serviceId)));
  };
};
