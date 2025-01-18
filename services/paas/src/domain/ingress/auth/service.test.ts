import { ConfigService, PaasConfig } from '../../../util/config';
import { Oauth2ProviderRegistry } from './oauth-provider/registry';
import { AuthService } from './service';

describe('user authorization service', () => {
  const mockConfigService: jest.Mocked<ConfigService> = {
    getConfig: jest.fn(),
  } as Partial<jest.Mocked<ConfigService>> as jest.Mocked<ConfigService>;

  const mockProviderRegistry: jest.Mocked<Oauth2ProviderRegistry> = {
    getProvider: jest.fn(),
  } as Partial<
    jest.Mocked<Oauth2ProviderRegistry>
  > as jest.Mocked<Oauth2ProviderRegistry>;

  const setupConfigMock = (args: { paasAuthorizedUserIds?: string[] }) => {
    mockConfigService.getConfig.mockReturnValue({
      paas: {
        rootDomain: 'paas.localhost',
        auth: {
          authorizedUserIds: args.paasAuthorizedUserIds ?? [],
          adminUserIds: [],
          jwtSecret: 'jwt-secret-123',
          oauth2Provider: {
            type: 'github',
            clientId: 'client-id-123',
            clientSecret: 'client-secret-123',
          },
          sessionLifetimeSeconds: 123,
        },
      } as Partial<PaasConfig['paas']>,
    } as Partial<PaasConfig> as PaasConfig);
  };

  let authService: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    authService = new AuthService(mockConfigService, mockProviderRegistry);
  });

  describe('isUserAuthorized', () => {
    test('should deny user who is not in paas users, even if they are present in service users', () => {
      const serviceAuthorizedUserIds = ['user-service'];
      setupConfigMock({
        paasAuthorizedUserIds: ['user-pass'],
      });

      expect(
        authService.isUserAuthorized('user-service', serviceAuthorizedUserIds),
      ).toBe(false);
    });

    test('should deny user who is not in service users, even if they are present in paas users', () => {
      const serviceAuthorizedUserIds = ['user-service'];
      setupConfigMock({
        paasAuthorizedUserIds: ['user-pass'],
      });

      expect(
        authService.isUserAuthorized('user-paas', serviceAuthorizedUserIds),
      ).toBe(false);
    });

    test('should allow user who is present in both paas and service users', () => {
      const serviceAuthorizedUserIds = ['user-both'];
      setupConfigMock({
        paasAuthorizedUserIds: ['user-both'],
      });

      expect(
        authService.isUserAuthorized('user-both', serviceAuthorizedUserIds),
      ).toBe(true);
    });

    test('should allow paas user is there is no authorization list defined for the service', () => {
      const serviceAuthorizedUserIds = undefined;
      setupConfigMock({
        paasAuthorizedUserIds: ['user-paas'],
      });

      expect(
        authService.isUserAuthorized('user-paas', serviceAuthorizedUserIds),
      ).toBe(true);
    });
  });
});
