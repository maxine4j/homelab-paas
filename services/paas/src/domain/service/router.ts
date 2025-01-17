import { Context } from 'koa';
import Router from '@koa/router';
import { ServiceDescriptor } from './service-descriptor';
import { StartDeploymentHandler } from './deployment/service';
import { validate } from '../../util/validation';

export const createDeploymentRouter = (
  startDeployment: StartDeploymentHandler,
) => {
  
  const postDeploy = async (ctx: Context) => {
    const serviceDescriptor = validate(ctx.request.body.serviceDescriptor, ServiceDescriptor);

    const { deploymentId } = await startDeployment(serviceDescriptor);

    ctx.status = 200;
    ctx.body = {
      deploymentId,
    }
  };

  return new Router()
    .post('/service/deploy', postDeploy);
};
