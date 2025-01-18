import Router from '@koa/router';
import { Context } from 'koa';
import { validate } from '../../util/validation';
import { DeployService } from './deployment/service';
import { ServiceDescriptor } from './service-descriptor';

export class ServiceRouter {
  constructor(private readonly deployService: DeployService) {}

  public routes() {
    return new Router()
      .post('/service/deploy', this.postDeploy.bind(this))
      .routes();
  }

  private async postDeploy(ctx: Context) {
    const serviceDescriptor = validate(
      ctx.request.body.serviceDescriptor,
      ServiceDescriptor,
    );

    const { deploymentId } =
      await this.deployService.startDeployment(serviceDescriptor);

    ctx.status = 200;
    ctx.body = {
      deploymentId,
    };
  }
}
