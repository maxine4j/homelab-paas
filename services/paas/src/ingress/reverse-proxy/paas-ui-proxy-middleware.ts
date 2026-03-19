import { Middleware } from 'koa';
import { ConfigService } from '../../util/config';
import { RequestForwarder } from '../../util/request-forwarder';

export const createPaasUiProxyMiddleware = (
  configService: ConfigService,
  forwardRequest: RequestForwarder,
): Middleware => {
  return async (ctx, next) => {
    if (ctx.hostname === configService.getConfig().paas.rootDomain) {
      await forwardRequest({
        ctx,
        hostname: 'paas-ui',
        port: 3000,
      });
      return;
    }
    await next();
  };
};
