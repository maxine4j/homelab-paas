import { Context } from 'koa';
import Router from '@koa/router';
import { DeployCommandHandler } from './deploy-handler';

export const createDeployRouter = (
  deploy: DeployCommandHandler
) => {
  
  const postDeploy = async (ctx: Context) => {
    await deploy({
      serviceId: 'test-service',
      resources: [{
        name: 'WebServer',
        type: 'WebServer',
        image: {
          repository: 'test-service',
          tag: 'latest',
        }
      }]
    });

    ctx.status = 200;
  };
  
  return new Router()
    .post('/deploy', postDeploy);
};
