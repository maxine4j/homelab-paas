import jwt from 'jsonwebtoken';
import { AuthedUserDetails, Oauth2Provider } from './oauth-provider/types';

export class AuthService {
  constructor(
    private readonly provider: Oauth2Provider,
    private readonly jwtSecret: string,
    private readonly sessionLifetimeSeconds: number,
  ) {}

  public getLoginUrl(finalRedirectUri: string): string {
    return this.provider.getLoginUrl(finalRedirectUri);
  }

  public async issueAuthCookie(oauth2Code: string): Promise<string> {
    const accessToken = await this.provider.fetchAccessToken(oauth2Code);
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
}
