import jwt from 'jsonwebtoken';
import { AuthedUserDetails, Oauth2Provider } from './oauth-provider/types';

export class AuthService {
  constructor(
    private readonly provider: Oauth2Provider,
    private readonly jwtSecret: string,
    private readonly sessionLifetimeSeconds: number,
    private readonly paasAuthorizedUserIds: string[],
  ) {}

  public getLoginUrl(finalRedirectUri: string): string {
    return this.provider.getLoginUrl(finalRedirectUri);
  }

  public async issueAuthCookie(oauth2CallbackCode: string): Promise<string> {
    const accessToken = await this.provider.fetchAccessToken(oauth2CallbackCode);
    const userDetails = await this.provider.fetchUserDetails(accessToken);
    
    return jwt.sign(userDetails, this.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: this.sessionLifetimeSeconds,
    });
  }

  public verifyAuthCookie(authCookie: string | undefined): AuthedUserDetails | undefined {
    if (!authCookie) {
      return undefined;
    }
  
    try {
      const payload = jwt.verify(authCookie, this.jwtSecret, {
        algorithms: ['HS256'],
      });
      return payload as AuthedUserDetails;
    } catch {
      return undefined;
    }
  }

  public isUserAuthorized(userId: string, serviceAuthorizedUserIds: string[] | undefined): boolean {
    // user must be authorized to access the paas regardless of service auth
    if (!this.paasAuthorizedUserIds.includes(userId)) {
      return false;
    }
    
    // if the service does not define a list of authorized users, then any paas user can access the service
    if (serviceAuthorizedUserIds === undefined) {
      return true;
    }

    // if the service does define a list of authorized users, only allow those users access
    return serviceAuthorizedUserIds.includes(userId);
  }
}
