import { TaskQueue } from '../../../task/queue';
import { ServiceDescriptor } from '../service-descriptor';
import { DeploymentDeployTask } from './deploy-task';
import { createDeploymentStartHandler } from './start-handler';

describe('start deployment handler', () => {

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
  } as Partial<jest.Mocked<TaskQueue<DeploymentDeployTask>>> as unknown as jest.Mocked<TaskQueue<DeploymentDeployTask>>

  const startDeployment = createDeploymentStartHandler(mockGenerateDeploymentId, mockDeploymentTaskQueue);

  test('should enqueue a deployment task and return deployment id', async () => {
    mockGenerateDeploymentId.mockReturnValue('deployment-123');

    await expect(startDeployment(mockServiceDescriptor)).resolves.toEqual({
      deploymentId: 'deployment-123',
    });
  });
});