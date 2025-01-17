import { ServiceRepository } from '../service/repository';
import { NetworkSyncTask } from './sync-task';

describe('network sync task', () => {

  const mockNetworkConnectHandler = jest.fn();
  const mockServiceRepository = {
    queryAllServices: jest.fn(),
  } satisfies Partial<jest.Mocked<ServiceRepository>> as unknown as jest.Mocked<ServiceRepository>;

  const networkSyncTask = new NetworkSyncTask(
    mockNetworkConnectHandler,
    mockServiceRepository,
  );

  test('should attempt to connect networks for all services', async () => {
    mockServiceRepository.queryAllServices.mockResolvedValue([
      { serviceId: 'service-123' },
      { serviceId: 'service-234' },
      { serviceId: 'service-345' },
    ]);

    await networkSyncTask.run();

    expect(mockNetworkConnectHandler).toHaveBeenCalledWith('service-123');
    expect(mockNetworkConnectHandler).toHaveBeenCalledWith('service-234');
    expect(mockNetworkConnectHandler).toHaveBeenCalledWith('service-345');
  });
});
