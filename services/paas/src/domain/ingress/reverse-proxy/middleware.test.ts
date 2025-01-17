import { ServiceRepository } from '../../service/repository';
import { createReverseProxyMiddleware } from './middleware';
import { DeploymentRecord, DeploymentRepository } from '../../service/deployment/repository';
import { UserAuthorizationChecker } from '../auth/authz';
import { RequestForwarder } from './forward';
import { AuthenticatedUserGetter } from '../auth/authn';
import { startMiddlewareTestApi } from '../../../util/test/router';
import supertest from 'supertest';
import { AuthedUserDetails } from '../auth/oauth';

describe('reverse proxy middleware', () => {

  const mockRootDomain = 'paas.localhost';
  const mockLoginUrl = 'auth-provider.localhost/login';

  const mockServiceRepository = {
    queryService: jest.fn(),
  } satisfies Partial<jest.Mocked<ServiceRepository>> as unknown as jest.Mocked<ServiceRepository>;
  const mockDeploymentRepository = {
    query: jest.fn(),
  } satisfies Partial<jest.Mocked<DeploymentRepository>> as unknown as jest.Mocked<DeploymentRepository>;
  const mockGetAuthenticatedUser: jest.MockedFn<AuthenticatedUserGetter> = jest.fn();
  const mockIsAuthorized: jest.MockedFn<UserAuthorizationChecker> = jest.fn();
  const mockForwardRequest: jest.MockedFn<RequestForwarder> = jest.fn()
    .mockImplementation(async ({ ctx }) => {
      ctx.res.statusCode = 200;
      ctx.res.end();
    });

  const reverseProxyMiddleware = createReverseProxyMiddleware(
    mockServiceRepository,
    mockDeploymentRepository,
    mockGetAuthenticatedUser,
    mockIsAuthorized,
    mockForwardRequest,
    mockRootDomain,
    () => mockLoginUrl,
  );

  const server = startMiddlewareTestApi(
    reverseProxyMiddleware,
    (ctx) => {
      ctx.status = 200;
      ctx.body = 'paas';
    }
  )

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
        }
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
        }
      } as Partial<DeploymentRecord> as DeploymentRecord);
      mockGetAuthenticatedUser.mockResolvedValue(undefined);

      const response = await supertest(server)
        .get('/')
        .set('Host', `service-123.${mockRootDomain}`)
        .send();

      expect(response.status).toBe(302)
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
        }
      } as Partial<DeploymentRecord> as DeploymentRecord);
      mockGetAuthenticatedUser.mockResolvedValue({
        username: 'user-123',
      } as Partial<AuthedUserDetails> as AuthedUserDetails);
      mockIsAuthorized.mockReturnValue(false);

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
      mockGetAuthenticatedUser.mockResolvedValue({
        username: 'user-123',
      } as Partial<AuthedUserDetails> as AuthedUserDetails);
      mockIsAuthorized.mockReturnValue(true);

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
        }
      } as Partial<DeploymentRecord> as DeploymentRecord);
      mockGetAuthenticatedUser.mockResolvedValue({
        username: 'user-123',
      } as Partial<AuthedUserDetails> as AuthedUserDetails);
      mockIsAuthorized.mockReturnValue(true);

      const response = await supertest(server)
        .get('/')
        .set('Host', `service-123.${mockRootDomain}`)
        .send();

      expect(response.status).toBe(200);
      expect(mockForwardRequest).toHaveBeenCalledWith({
        ctx: expect.anything(),
        authedUserDetails: expect.objectContaining({ username: 'user-123' }),
        serviceContainer: {
          hostname: 'service-123-deployment-123',
          port: 8080,
        },
      })
    });
  });
});
