import Router from '@koa/router';
import { Context } from 'koa';
import yaml from 'yaml';
import { ValidationError } from '../../util/error';
import { parseBearerToken } from '../../util/http';
import { logger } from '../../util/logger';
import { validate } from '../../util/validation';
import { AuthService } from '../../ingress/auth/auth-service';
import { ServiceDescriptor } from '../service-descriptor';
import { DeployService } from './service';

export const createDeployRouter = (
  authService: AuthService,
  deployService: DeployService,
) => {
  const postDeploy = async (ctx: Context) => {
    const { serviceDescriptor: sdRaw } = ctx.request.body as {
      serviceDescriptor?: string;
    };

    if (!sdRaw) {
      ctx.status = 400;
      ctx.body = { message: 'serviceDescriptor is required' };
      return;
    }

    let serviceDescriptor: ServiceDescriptor;
    try {
      const sdParsed = yaml.parse(sdRaw);
      serviceDescriptor = validate(sdParsed, ServiceDescriptor);
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

  return new Router().post('/api/deploy', postDeploy);
};
