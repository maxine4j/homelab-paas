import Router from '@koa/router';
import { Context } from 'koa';
import yaml from 'yaml';
import { ValidationError } from '../../../util/error';
import { parseBearerToken } from '../../../util/http';
import { logger } from '../../../util/logger';
import { validate } from '../../../util/validation';
import { AuthService } from '../../ingress/auth/service';
import { ServiceDescriptor } from '../service-descriptor';
import { DeployService } from './service';

export const createDeployRouter = (
  authService: AuthService,
  deployService: DeployService,
) => {
  const postDeploy = async (ctx: Context) => {
    const deployToken = parseBearerToken(ctx.headers['authorization']);
    if (!deployToken) {
      ctx.status = 401;
      return;
    }

    let serviceDescriptor: ServiceDescriptor;
    try {
      serviceDescriptor = validate(ctx.request.body, ServiceDescriptor);
    } catch (error) {
      logger.info({ error }, 'Failed to validate service descriptor');
      if (error instanceof ValidationError) {
        ctx.status = 400;
        ctx.body = {
          message: error.message,
          validationErrors: error.errors,
        };
        return;
      }
      throw error;
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
