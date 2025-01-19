import supertest from 'supertest';
import yaml from 'yaml';
import { startTestApi } from '../../../util/test/router';
import { AuthService } from '../../ingress/auth/service';
import { ServiceDescriptor } from '../service-descriptor';
import { createDeployRouter } from './router';
import { DeployService } from './service';

describe('service deploy router', () => {
  const mockServiceDescriptor = {
    serviceId: 'service-123',
    image: 'image-123',
    ingress: {
      containerPort: 8080,
    },
  } satisfies ServiceDescriptor;

  const mockDeployService: jest.Mocked<DeployService> = {
    startDeployment: jest.fn(),
  } as Partial<jest.Mocked<DeployService>> as jest.Mocked<DeployService>;

  const mockAuthService: jest.Mocked<AuthService> = {
    isDeployTokenAuthorized: jest.fn(),
  } as Partial<jest.Mocked<AuthService>> as jest.Mocked<AuthService>;

  const deployRouter = createDeployRouter(mockAuthService, mockDeployService);

  const server = startTestApi(deployRouter.routes());

  afterAll(() => {
    server.close();
  });

  test('should response with 400 and validation errors when sd is invalid', async () => {
    const response = await supertest(server).post('/service/deploy').send({
      serviceDescriptor: 'invalid',
    });

    expect(response.status).toBe(400);
    expect(mockDeployService.startDeployment).not.toHaveBeenCalled();
  });

  test('should respond with 401 and not start deployment when no auth header', async () => {
    const response = await supertest(server)
      .post('/service/deploy')
      .send({
        serviceDescriptor: yaml.stringify(mockServiceDescriptor),
      });

    expect(response.status).toBe(401);
    expect(mockDeployService.startDeployment).not.toHaveBeenCalled();
  });

  test('should respond 403 and not start deployment when bearer token not authorized ', async () => {
    mockAuthService.isDeployTokenAuthorized.mockReturnValue(false);

    const response = await supertest(server)
      .post('/service/deploy')
      .set('Authorization', 'Bearer not-authorized')
      .send({
        serviceDescriptor: yaml.stringify(mockServiceDescriptor),
      });

    expect(response.status).toBe(403);
    expect(mockDeployService.startDeployment).not.toHaveBeenCalled();
  });

  test('should respond with 200 and start deployment when bearer token is authorized', async () => {
    mockAuthService.isDeployTokenAuthorized.mockReturnValue(true);

    mockDeployService.startDeployment.mockResolvedValue({
      deploymentId: 'deployment-123',
    });

    const response = await supertest(server)
      .post('/service/deploy')
      .set('Authorization', 'Bearer authorized')
      .send({
        serviceDescriptor: yaml.stringify(mockServiceDescriptor),
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
