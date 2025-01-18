import { Context } from 'koa';
import Router from '@koa/router';
import { ServiceDescriptor } from './service-descriptor';
import { DeployService } from './deployment/service';
import { validate } from '../../util/validation';

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
