import Router from '@koa/router';
import { logger } from '../../../util/logger';
import { ContextualError } from '../../../util/error';
import { config } from '../../../util/config';
import { AuthService } from './service';

export const createAuthRouter = (
  authService: AuthService,
) => {
  
  return new Router()
    .get('/auth/callback', async (ctx) => {
      const code = ctx.query['code'] as string | undefined;
      if (!code) {
        throw new ContextualError('Failed to authenticate user: Code not provided');
      }
      const redirectUri = ctx.query['redirect_uri'] as string | undefined;
      if (!redirectUri) {
        throw new ContextualError('Failed to authenticate user: Redirect URI not provided')
      }

      logger.info('Authenticating user');
      const jwt = await authService.issueAuthCookie(code);
      ctx.cookies.set(config.auth.cookieName, jwt, {
        domain: config.rootDomain,
      });

      ctx.redirect(redirectUri);
    });
};
