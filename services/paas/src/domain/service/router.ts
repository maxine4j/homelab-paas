import { Context } from 'koa';
import Router from '@koa/router';
import { DeployCommandHandler } from './deploy-handler';
import { ServiceStateQueryHandler } from './state/query-state';

export const createServiceRouter = (
  deployService: DeployCommandHandler,
  queryServiceState: ServiceStateQueryHandler,
) => {
  
  const postDeploy = async (ctx: Context) => {
    await deployService({
      serviceId: 'test-service',
      image: 'test-service:latest',
    });

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
