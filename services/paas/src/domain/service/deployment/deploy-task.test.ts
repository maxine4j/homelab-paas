import { DockerService } from '../../../docker/service';
import { QueueTask, TaskEnvelope } from '../../../task/queue';
import { ServiceConnectNetworkHandler } from '../connect-handler';
import { ServiceRepository } from '../repository';
import { createDeploymentDeployTask, DeploymentDeployTask } from './deploy-task';
import { DeploymentRepository } from './repository';

describe('deploy-task', () => {

  const mockTask: TaskEnvelope<DeploymentDeployTask> = {
    taskId: 'task-123',
    task: {
      deploymentId: 'deployment-123',
      serviceId: 'service-123',
      serviceDescriptor: {
        serviceId: 'service-123',
        image: 'image-123',
        ingress: {
          containerPort: 8080,
        },
      }
    }
  };

  const mockDockerService = {
    pullImageIfNotPresent: jest.fn(),
    findNetwork: jest.fn(),
    runContainer: jest.fn(),
    isContainerRunning: jest.fn(),
  } satisfies Partial<jest.Mocked<DockerService>> as unknown as jest.Mocked<DockerService>;

  const mockDeploymentRepository = {
    createDeployment: jest.fn(),
    markDeploymentFailed: jest.fn(),
    markDeploymentRunning: jest.fn(),
  } satisfies Partial<jest.Mocked<DeploymentRepository>> as unknown as jest.Mocked<DeploymentRepository>;

  const mockServiceRepository = {
    queryService: jest.fn(),
    createService: jest.fn(),
    setActiveDeployment: jest.fn(),
  } satisfies Partial<jest.Mocked<ServiceRepository>> as unknown as jest.Mocked<ServiceRepository>

  const mockConnectService: jest.MockedFn<ServiceConnectNetworkHandler> = jest.fn();

  let deployTask: QueueTask<DeploymentDeployTask>;

  beforeEach(() => {
    jest.clearAllMocks();

    deployTask = createDeploymentDeployTask(
      mockDockerService,
      mockDeploymentRepository,
      mockServiceRepository,
      mockConnectService,
      {
        delayMs: 0,
        maxAttempts: 1,
      }
    );

    mockDockerService.findNetwork.mockResolvedValue('network-123');
    mockDockerService.runContainer.mockResolvedValue({ hostname: 'service-123-deployment-123' });
    mockDockerService.isContainerRunning.mockResolvedValue(true);
  });

  test('should create new service for first deployment of a new service', async () => {
    mockServiceRepository.queryService.mockResolvedValue(undefined);

    await deployTask(mockTask);

    expect(mockServiceRepository.createService).toHaveBeenCalledWith('service-123');
  });

  test('should not create a new service for deployments of existing service', async () => {
    mockServiceRepository.queryService.mockResolvedValue({ serviceId: 'service-123' });

    await deployTask(mockTask);

    expect(mockServiceRepository.createService).not.toHaveBeenCalled();
  });

  test('should successfully deploy and wire up deployment', async () => {
    await deployTask(mockTask);

    expect(mockConnectService).toHaveBeenCalledWith('service-123');
    expect(mockDockerService.pullImageIfNotPresent).toHaveBeenCalledWith('image-123');
    expect(mockDeploymentRepository.createDeployment).toHaveBeenCalledWith('deployment-123', mockTask.task.serviceDescriptor);
    expect(mockDockerService.runContainer).toHaveBeenCalledWith({
      serviceId: 'service-123',
      deploymentId: 'deployment-123',
      image: 'image-123',
      networkId: 'network-123',
    });
    expect(mockDeploymentRepository.markDeploymentRunning).toHaveBeenCalledWith('deployment-123', { hostname: 'service-123-deployment-123', port: 8080 });
    expect(mockServiceRepository.setActiveDeployment).toHaveBeenCalledWith('service-123', 'deployment-123');
    expect(mockDeploymentRepository.markDeploymentFailed).not.toHaveBeenCalled();
  });

  test('should throw when service network not found', async () => {
    mockDockerService.findNetwork.mockResolvedValue(undefined);

    await expect(deployTask(mockTask)).rejects.toThrow('Failed to find service network');
  });

  test('should mark deployment as failed when container fails to start', async () => {
    mockDockerService.isContainerRunning.mockResolvedValue(false);

    await deployTask(mockTask);

    expect(mockDeploymentRepository.markDeploymentFailed).toHaveBeenCalledWith('deployment-123', 'Container failed to start');
    expect(mockDeploymentRepository.markDeploymentRunning).not.toHaveBeenCalled();
    expect(mockServiceRepository.setActiveDeployment).not.toHaveBeenCalled();
  });
});
