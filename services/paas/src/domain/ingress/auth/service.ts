import jwt from 'jsonwebtoken';
import { ConfigService } from '../../../util/config';
import { logger } from '../../../util/logger';
import { Oauth2ProviderRegistry } from './oauth-provider/registry';
import { AuthedUserDetails } from './oauth-provider/types';

export class AuthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly providerRegistry: Oauth2ProviderRegistry,
  ) {}

  public getLoginUrl(finalRedirectUri: string): string {
    const { provider } = this.getConfig();
    return provider.getLoginUrl(finalRedirectUri);
  }

  public async issueAuthCookie(oauth2CallbackCode: string): Promise<string> {
    const { provider, jwtSecret, sessionLifetimeSeconds } = this.getConfig();

    const accessToken = await provider.fetchAccessToken(oauth2CallbackCode);
    const userDetails = await provider.fetchUserDetails(accessToken);

    return jwt.sign(userDetails, jwtSecret, {
      algorithm: 'HS256',
      expiresIn: sessionLifetimeSeconds,
    });
  }

  public verifyAuthCookie(
    authCookie: string | undefined,
  ): AuthedUserDetails | undefined {
    if (!authCookie) {
      return undefined;
    }

    try {
      const payload = jwt.verify(
        authCookie,
        this.configService.getConfig().paas.auth.jwtSecret,
        {
          algorithms: ['HS256'],
        },
      );
      return payload as AuthedUserDetails;
    } catch {
      return undefined;
    }
  }

  public isDeployTokenAuthorized(
    serviceId: string,
    deployToken: string,
  ): boolean {
    const { deployTokens } = this.getConfig();

    const serviceDeployTokens = deployTokens?.[serviceId];
    if (!serviceDeployTokens) {
      logger.info({ serviceId }, 'No deploy tokens configured for service');
      return false;
    }

    if (serviceDeployTokens.includes(deployToken)) {
      return true;
    }

    logger.info(
      { serviceId },
      'Deploy token bearer is not authorized to deploy service',
    );
    return false;
  }

  public isUserAuthorizedToAccessService(
    userId: string,
    serviceAuthorizedUserIds: string[] | undefined,
  ): boolean {
    const { authorizedUserIds } = this.getConfig();

    // user must be authorized to access the paas regardless of service auth
    if (!authorizedUserIds.includes(userId)) {
      return false;
    }

    // if the service does not define a list of authorized users, then any paas user can access the service
    if (serviceAuthorizedUserIds === undefined) {
      return true;
    }

    // if the service does define a list of authorized users, only allow those users access
    return serviceAuthorizedUserIds.includes(userId);
  }

  public isUserAuthorizedToAccessPaas(userId: string): boolean {
    const { authorizedUserIds, adminUserIds } = this.getConfig();

    // user must be authorized to access the paas regardless of being an admin
    if (!authorizedUserIds.includes(userId)) {
      return false;
    }

    // user must be an admin to access paas
    if (!adminUserIds.includes(userId)) {
      return false;
    }

    return true;
  }

  private getConfig() {
    const config = this.configService.getConfig();
    return {
      provider: this.providerRegistry.getProvider(
        config.paas.auth.oauth2Provider.type,
      ),
      sessionLifetimeSeconds: config.paas.auth.sessionLifetimeSeconds,
      jwtSecret: config.paas.auth.jwtSecret,
      authorizedUserIds: config.paas.auth.authorizedUserIds,
      adminUserIds: config.paas.auth.adminUserIds,
      deployTokens: config.paas.auth.deployTokens,
    };
  }
}
