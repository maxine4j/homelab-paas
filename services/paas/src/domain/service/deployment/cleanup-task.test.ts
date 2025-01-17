import { DockerService } from '../../../docker/service';
import { PeriodicTask } from '../../../task/periodic';
import { ServiceRepository } from '../repository';
import { DeploymentCleanupTask } from './cleanup-task';
import { DeploymentRepository } from './repository';

describe('cleanup-task', () => {

  const mockDockerService = {
    findAllContainers: jest.fn(),
    terminateContainer: jest.fn(),
  } satisfies Partial<jest.Mocked<DockerService>> as unknown as jest.Mocked<DockerService>;

  const mockDeploymentRepository = {
    query: jest.fn(),
    queryByStatus: jest.fn(),
    markDeploymentCleanedUp: jest.fn(),
  } satisfies Partial<jest.Mocked<DeploymentRepository>> as unknown as jest.Mocked<DeploymentRepository>;

  const mockServiceRepository = {
    queryAllServices: jest.fn(),
  } satisfies Partial<jest.Mocked<ServiceRepository>> as unknown as jest.Mocked<ServiceRepository>;

  let cleanupTask: PeriodicTask;

  beforeEach(() => {
    jest.clearAllMocks();

    cleanupTask = new DeploymentCleanupTask(
      mockDockerService,
      mockDeploymentRepository,
      mockServiceRepository,
    )
  })

  test('should cleanup non-deploying, non-active deployments', async () => {
    mockDockerService.findAllContainers.mockResolvedValue([
      {
        serviceId: 'service-123',
        containerId: 'container-123-stale',
        deploymentId: 'deployment-123-stale',
      },
      {
        serviceId: 'service-123',
        containerId: 'container-234-active',
        deploymentId: 'deployment-234-active',
      },
      {
        serviceId: 'service-123',
        containerId: 'container-345-deploying',
        deploymentId: 'deployment-345-deploying',
      }
    ]);
    mockDeploymentRepository.query.mockImplementation(async (deploymentId) => ({
      deploymentId,
    } as any));
    mockDeploymentRepository.queryByStatus.mockResolvedValue([
      {
        deploymentId: 'deployment-345-deploying',
        createdAt: new Date(),
        serviceDescriptor: {} as any,
        serviceId: 'service-345',
        status: 'deploying',
      },
    ]);
    mockServiceRepository.queryAllServices.mockResolvedValue([
      { 
        serviceId: 'service-123', 
        activeDeploymentId: 'deployment-234-active' 
      }
    ]);
    
    await cleanupTask.run();

    expect(mockDockerService.terminateContainer).toHaveBeenCalledTimes(1);
    expect(mockDockerService.terminateContainer).toHaveBeenCalledWith('container-123-stale');
    expect(mockDeploymentRepository.markDeploymentCleanedUp).toHaveBeenCalledWith('deployment-123-stale');
  });

  test('should not attempt to mark deployment as cleaned up if container labelled with deployment that does not exist', async () => {
    mockDockerService.findAllContainers.mockResolvedValue([
      {
        serviceId: undefined,
        containerId: 'container-123-orphaned',
        deploymentId: 'deployment-123-orphaned',
      },
    ]);
    mockDeploymentRepository.query.mockResolvedValue(undefined);
    mockDeploymentRepository.queryByStatus.mockResolvedValue([]);
    mockServiceRepository.queryAllServices.mockResolvedValue([]);
    
    await cleanupTask.run();

    expect(mockDockerService.terminateContainer).toHaveBeenCalledWith('container-123-orphaned');
    expect(mockDeploymentRepository.markDeploymentCleanedUp).not.toHaveBeenCalled();

  })

  test('should cleanup orphaned containers', async () => {
    mockDockerService.findAllContainers.mockResolvedValue([
      {
        serviceId: undefined,
        containerId: 'container-123-orphaned',
        deploymentId: undefined,
      },
    ]);
    mockDeploymentRepository.queryByStatus.mockResolvedValue([]);
    mockServiceRepository.queryAllServices.mockResolvedValue([]);
    
    await cleanupTask.run();

    expect(mockDockerService.terminateContainer).toHaveBeenCalledWith('container-123-orphaned');
  });
});
