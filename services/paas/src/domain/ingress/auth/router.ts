import Router from '@koa/router';
import { logger } from '../../../util/logger';
import { ContextualError } from '../../../util/error';
import { authorizeUser } from './oauth';
import { config } from '../../../util/config';

export const createAuthRouter = () => {
  
  return new Router()
    .get('/auth/callback', async (ctx) => {
      const code = ctx.query['code'] as string | undefined;
      if (!code) {
        throw new ContextualError('Failed to authorize user: Code not provided');
      }
      const redirectUri = ctx.query['redirect_uri'] as string | undefined;
      if (!redirectUri) {
        throw new ContextualError('Failed to authorize user: Redirect URI not provided')
      }

      logger.info('Authorizing user');
      const jwt = await authorizeUser(code);
      ctx.cookies.set(config.auth.cookieName, jwt, {
        domain: config.rootDomain,
      });

      ctx.redirect(redirectUri);
    });
};
