import supertest from 'supertest';
import { ConfigService } from '../../../util/config';
import { RequestForwarder } from '../../../util/request-forwarder';
import { startMiddlewareTestApi } from '../../../util/test/router';
import {
  DeploymentRecord,
  DeploymentRepository,
} from '../../service/deployment/repository';
import { ServiceRepository } from '../../service/repository';
import { AuthedUserDetails } from '../auth/oauth-provider/types';
import { AuthService } from '../auth/service';
import { createReverseProxyMiddleware } from './middleware';

describe('reverse proxy middleware', () => {
  const mockRootDomain = 'paas.localhost';
  const mockLoginUrl = 'auth-provider.localhost/login';

  const mockServiceRepository: jest.Mocked<ServiceRepository> = {
    queryService: jest.fn(),
  } as Partial<
    jest.Mocked<ServiceRepository>
  > as jest.Mocked<ServiceRepository>;

  const mockDeploymentRepository: jest.Mocked<DeploymentRepository> = {
    query: jest.fn(),
  } as Partial<
    jest.Mocked<DeploymentRepository>
  > as jest.Mocked<DeploymentRepository>;

  const mockAuthService: jest.Mocked<AuthService> = {
    getLoginUrl: jest.fn().mockReturnValue(mockLoginUrl),
    issueAuthCookie: jest.fn(),
    verifyAuthCookie: jest.fn(),
    isUserAuthorizedToAccessService: jest.fn(),
  } as Partial<jest.Mocked<AuthService>> as jest.Mocked<AuthService>;

  const mockForwardRequest: jest.MockedFn<RequestForwarder> = jest
    .fn()
    .mockImplementation(async ({ ctx }) => {
      ctx.res.statusCode = 200;
      ctx.res.end();
    });

  const mockConfigService: jest.Mocked<ConfigService> = {
    getConfig: jest.fn().mockReturnValue({
      paas: {
        rootDomain: mockRootDomain,
      },
    }),
    getAuthCookieName: jest.fn().mockReturnValue('auth-cookie'),
  } as Partial<jest.Mocked<ConfigService>> as jest.Mocked<ConfigService>;

  const reverseProxyMiddleware = createReverseProxyMiddleware(
    mockServiceRepository,
    mockDeploymentRepository,
    mockAuthService,
    mockForwardRequest,
    mockConfigService,
  );

  const server = startMiddlewareTestApi(reverseProxyMiddleware, (ctx) => {
    ctx.status = 200;
    ctx.body = 'paas';
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    server.close();
  });

  test('should not handle requests for paas', async () => {
    const response = await supertest(server)
      .get('/paas')
      .set('Host', mockRootDomain)
      .send();

    expect(response.status).toBe(200);
    expect(mockServiceRepository.queryService).not.toHaveBeenCalled();
    expect(mockDeploymentRepository.query).not.toHaveBeenCalled();
  });

  describe('public service', () => {
    test('should successfully forward request to service when active deployment exists', async () => {
      mockServiceRepository.queryService.mockResolvedValue({
        serviceId: 'service-123',
        activeDeploymentId: 'deployment-123',
      });
      mockDeploymentRepository.query.mockResolvedValue({
        serviceDescriptor: {
          ingress: {
            public: true,
          },
        },
        container: {
          hostname: 'service-123-deployment-123',
          port: 8080,
        },
      } as Partial<DeploymentRecord> as DeploymentRecord);

      const response = await supertest(server)
        .get('/')
        .set('Host', `service-123.${mockRootDomain}`)
        .send();

      expect(response.status).toBe(200);
    });
  });

  describe('private service', () => {
    test('should redirect to login url when auth cookie missing', async () => {
      mockServiceRepository.queryService.mockResolvedValue({
        serviceId: 'service-123',
        activeDeploymentId: 'deployment-123',
      });
      mockDeploymentRepository.query.mockResolvedValue({
        container: {
          hostname: 'service-123-deployment-123',
          port: 8080,
        },
      } as Partial<DeploymentRecord> as DeploymentRecord);
      mockAuthService.verifyAuthCookie.mockReturnValue(undefined);

      const response = await supertest(server)
        .get('/')
        .set('Host', `service-123.${mockRootDomain}`)
        .send();

      expect(response.status).toBe(302);
      expect(response.headers['location']).toEqual(mockLoginUrl);
    });

    test('should respond with 403 when user is not authorized', async () => {
      mockServiceRepository.queryService.mockResolvedValue({
        serviceId: 'service-123',
        activeDeploymentId: 'deployment-123',
      });
      mockDeploymentRepository.query.mockResolvedValue({
        container: {
          hostname: 'service-123-deployment-123',
          port: 8080,
        },
      } as Partial<DeploymentRecord> as DeploymentRecord);
      mockAuthService.verifyAuthCookie.mockReturnValue({
        userId: 'user-123',
      } as Partial<AuthedUserDetails> as AuthedUserDetails);
      mockAuthService.isUserAuthorizedToAccessService.mockReturnValue(false);

      const response = await supertest(server)
        .get('/')
        .set('Host', `service-123.${mockRootDomain}`)
        .send();

      expect(response.status).toBe(403);
    });

    test('should respond with 503 when user is authorized and active deployment does not exist', async () => {
      mockServiceRepository.queryService.mockResolvedValue({
        serviceId: 'service-123',
        activeDeploymentId: undefined,
      });
      mockDeploymentRepository.query.mockResolvedValue(undefined);
      mockAuthService.verifyAuthCookie.mockReturnValue({
        userId: 'user-123',
      } as Partial<AuthedUserDetails> as AuthedUserDetails);
      mockAuthService.isUserAuthorizedToAccessService.mockReturnValue(true);

      const response = await supertest(server)
        .get('/')
        .set('Host', `service-123.${mockRootDomain}`)
        .send();

      expect(response.status).toBe(503);
    });

    test('should forward request to service when user is authorized and active deployment exists', async () => {
      mockServiceRepository.queryService.mockResolvedValue({
        serviceId: 'service-123',
        activeDeploymentId: 'deployment-123',
      });
      mockDeploymentRepository.query.mockResolvedValue({
        container: {
          hostname: 'service-123-deployment-123',
          port: 8080,
        },
      } as Partial<DeploymentRecord> as DeploymentRecord);
      mockAuthService.verifyAuthCookie.mockReturnValue({
        userId: 'user-123',
      } as Partial<AuthedUserDetails> as AuthedUserDetails);
      mockAuthService.isUserAuthorizedToAccessService.mockReturnValue(true);

      const response = await supertest(server)
        .get('/')
        .set('Host', `service-123.${mockRootDomain}`)
        .send();

      expect(response.status).toBe(200);
      expect(mockForwardRequest).toHaveBeenCalledWith({
        ctx: expect.anything(),
        hostname: 'service-123-deployment-123',
        port: 8080,
        additionalHeaders: expect.objectContaining({
          'PaasAuth-UserId': 'user-123',
        }),
      });
    });
  });
});
