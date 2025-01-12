import { Context } from 'koa';
import Router from '@koa/router';
import { DeployCommandHandler } from './deploy-handler';
import { ServiceStateQueryHandler } from './state/query-state';
import { ValidationError } from '../../util/error';
import { ServiceDescriptor } from './service-descriptor';
import { logger } from '../../util/logger';

export const createServiceRouter = (
  deployService: DeployCommandHandler,
  queryServiceState: ServiceStateQueryHandler,
) => {
  
  const postDeploy = async (ctx: Context) => {
    const serviceDescriptor = ctx.request.body.serviceDescriptor as ServiceDescriptor;
    if (!serviceDescriptor || !serviceDescriptor.image || !serviceDescriptor.serviceId) {
      throw new ValidationError(['serviceDescriptor not provided'])
    }

    await deployService(serviceDescriptor);

    ctx.status = 200;
  };

  const getServiceState = async (ctx: Context) => {
    const serviceId: string = ctx.params.serviceId;

    const state = await queryServiceState(serviceId);
    
    ctx.status = 200;
    ctx.body = state;
  }
  
  return new Router()
    .post('/service/deploy', postDeploy)
    .get('/service/:serviceId/state', getServiceState);
};
