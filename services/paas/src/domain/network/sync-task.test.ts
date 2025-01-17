import { ServiceRepository } from '../service/repository';
import { NetworkService } from './connect-handler';
import { NetworkSyncTask } from './sync-task';

describe('network sync task', () => {

  const mockNetworkService: jest.Mocked<NetworkService> = {
    connectServiceNetworkToPaas: jest.fn(),
  } as Partial<jest.Mocked<NetworkService>> as unknown as jest.Mocked<NetworkService>;

  const mockServiceRepository = {
    queryAllServices: jest.fn(),
  } satisfies Partial<jest.Mocked<ServiceRepository>> as unknown as jest.Mocked<ServiceRepository>;

  const networkSyncTask = new NetworkSyncTask(
    mockNetworkService,
    mockServiceRepository,
  );

  test('should attempt to connect networks for all services', async () => {
    mockServiceRepository.queryAllServices.mockResolvedValue([
      { serviceId: 'service-123' },
      { serviceId: 'service-234' },
      { serviceId: 'service-345' },
    ]);

    await networkSyncTask.run();

    expect(mockNetworkService.connectServiceNetworkToPaas).toHaveBeenCalledWith('service-123');
    expect(mockNetworkService.connectServiceNetworkToPaas).toHaveBeenCalledWith('service-234');
    expect(mockNetworkService.connectServiceNetworkToPaas).toHaveBeenCalledWith('service-345');
  });
});
