import supertest from 'supertest';
import { startTestApi } from '../../util/test/router';
import { createDeploymentRouter } from './router';
import { ServiceDescriptor } from './service-descriptor';

describe('deployment-router', () => {

  const mockServiceDescriptor = {
    serviceId: 'service-123',
    image: 'image-123',
    ingress: {
      containerPort: 8080,
    },
  } satisfies ServiceDescriptor

  const mockStartDeployment = jest.fn();
  const deploymentRouter = createDeploymentRouter(
    mockStartDeployment,
  );

  const server = startTestApi(deploymentRouter);

  afterAll(() => {
    server.close();
  });

  test('given valid request, should call register tenant and respond with 200', async () => {
    
    mockStartDeployment.mockResolvedValue({ deploymentId: 'deployment-123' });

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

    expect(mockStartDeployment).toHaveBeenCalledWith(mockServiceDescriptor);
  });
});
