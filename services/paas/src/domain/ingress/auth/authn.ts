import jwt from 'jsonwebtoken';
import { AuthedUserDetails } from './oauth';
import { config } from '../../../util/config';

export interface AuthenticatedUserGetter {
  (cookies: { get: (cookieName: string) => string | undefined }): Promise<AuthedUserDetails | undefined>
}

export const createGetAuthenticatedUser = (): AuthenticatedUserGetter =>
  async (cookies) => {
    const authCookie = cookies.get(config.auth.cookieName);
  
    if (!authCookie) {
      return undefined;
    }
  
    try {
      const payload = jwt.verify(authCookie, config.auth.jwtSecret, {
        algorithms: ['HS256'],
      });
      return payload as AuthedUserDetails;
    } catch {
      return undefined;
    }
  };
