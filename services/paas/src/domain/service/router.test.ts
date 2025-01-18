import supertest from 'supertest';
import { startTestApi } from '../../util/test/router';
import { DeployService } from './deployment/service';
import { ServiceRouter } from './router';
import { ServiceDescriptor } from './service-descriptor';

describe('service router', () => {
  const mockServiceDescriptor = {
    serviceId: 'service-123',
    image: 'image-123',
    ingress: {
      containerPort: 8080,
    },
  } satisfies ServiceDescriptor;

  const mockDeployService: jest.Mocked<DeployService> = {
    startDeployment: jest.fn(),
  } as Partial<
    jest.Mocked<DeployService>
  > as unknown as jest.Mocked<DeployService>;

  const deploymentRouter = new ServiceRouter(mockDeployService);

  const server = startTestApi(deploymentRouter.routes());

  afterAll(() => {
    server.close();
  });

  test('given valid request, should call register tenant and respond with 200', async () => {
    mockDeployService.startDeployment.mockResolvedValue({
      deploymentId: 'deployment-123',
    });

    const response = await supertest(server)
      .post('/service/deploy')
      .set('Authorization', 'Bearer: pipeline-123')
      .send({
        serviceDescriptor: mockServiceDescriptor,
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      deploymentId: 'deployment-123',
    });

    expect(mockDeployService.startDeployment).toHaveBeenCalledWith(
      mockServiceDescriptor,
    );
  });
});
