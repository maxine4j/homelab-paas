import { Context, Next } from 'koa';
import { ConfigService } from '../../../util/config';
import { AuthService } from './service';

export const createAuthorizedPaasAdminRequiredMiddleware =
  (authService: AuthService, configService: ConfigService) =>
  async (ctx: Context, next: Next) => {
    const authCookie = ctx.cookies.get(configService.getAuthCookieName());
    if (!authCookie) {
      ctx.redirect(authService.getLoginUrl(ctx.href));
      return;
    }

    const authedUserDetails = authService.verifyAuthCookie(authCookie);
    if (!authedUserDetails) {
      ctx.status = 401;
      return;
    }

    if (!authService.isUserAuthorizedToAccessPaas(authedUserDetails.userId)) {
      ctx.status = 403;
      return;
    }

    await next();
  };
