import jwt from 'jsonwebtoken';
import { ConfigService } from '../../../util/config';
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

  public isUserAuthorized(
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
    };
  }
}
