import { TaskQueue } from '../../../task/queue';
import { ServiceDescriptor } from '../service-descriptor';
import { DeployTask, DeployTaskDescriptor } from './deploy-task';
import { DeployService } from './service';

describe('deploy service', () => {

  const mockServiceDescriptor: ServiceDescriptor = {
    serviceId: 'service-123',
    image: 'image-123',
    ingress: {
      containerPort: 8080,
    },
  };

  const mockGenerateDeploymentId = jest.fn();
  const mockDeploymentTaskQueue= {
    enqueue: jest.fn(),
  } as Partial<jest.Mocked<TaskQueue<DeployTaskDescriptor>>> as unknown as jest.Mocked<TaskQueue<DeployTaskDescriptor>>

  const deployService = new DeployService(mockGenerateDeploymentId, mockDeploymentTaskQueue);

  test('should enqueue a deployment task and return deployment id', async () => {
    mockGenerateDeploymentId.mockReturnValue('deployment-123');

    await expect(deployService.startDeployment(mockServiceDescriptor)).resolves.toEqual({
      deploymentId: 'deployment-123',
    });
  });
});
