import { Context } from 'koa';
import Router from '@koa/router';
import { ValidationError } from '../../util/error';
import { ServiceDescriptor } from '../service/service-descriptor';
import { StartDeploymentHandler } from './start-handler';

export const createDeploymentRouter = (
  startDeployment: StartDeploymentHandler,
) => {
  
  const postDeploy = async (ctx: Context) => {
    const serviceDescriptor = ctx.request.body.serviceDescriptor as ServiceDescriptor;
    if (!serviceDescriptor || !serviceDescriptor.image || !serviceDescriptor.serviceId) {
      throw new ValidationError(['serviceDescriptor not provided'])
    }

    await startDeployment(serviceDescriptor);

    ctx.status = 200;
  };

  return new Router()
    .post('/deploy', postDeploy);
};
