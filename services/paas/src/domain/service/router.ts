import Router from '@koa/router';
import { Context } from 'koa';
import { parseBearerToken } from '../../util/http';
import { validate } from '../../util/validation';
import { AuthService } from '../ingress/auth/service';
import { DeployService } from './deployment/service';
import { ServiceDescriptor } from './service-descriptor';

export const createServiceRouter = (
  authService: AuthService,
  deployService: DeployService,
) => {
  const postDeploy = async (ctx: Context) => {
    const serviceDescriptor = validate(
      ctx.request.body.serviceDescriptor,
      ServiceDescriptor,
    );

    const deployToken = parseBearerToken(ctx.headers['authorization']);
    if (!deployToken) {
      ctx.status = 401;
      return;
    }

    if (
      !authService.isDeployTokenAuthorized(
        serviceDescriptor.serviceId,
        deployToken,
      )
    ) {
      ctx.status = 403;
      return;
    }

    const { deploymentId } =
      await deployService.startDeployment(serviceDescriptor);

    ctx.status = 200;
    ctx.body = {
      deploymentId,
    };
  };

  return new Router().post('/service/deploy', postDeploy);
};
