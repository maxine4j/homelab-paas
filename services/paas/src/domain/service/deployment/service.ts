import { TaskQueue } from '../../../task/queue'
import { ServiceDescriptor } from '../service-descriptor'
import { DeployTaskDescriptor } from './deploy-task'

export class DeployService {

  constructor (
    public readonly generateDeploymentId: () => string,
    public readonly deploymentTaskQueue: TaskQueue<DeployTaskDescriptor>
  ) {}

  public async startDeployment(serviceDescriptor: ServiceDescriptor) {
    const deploymentId = this.generateDeploymentId();

    await this.deploymentTaskQueue.enqueue({
      serviceId: serviceDescriptor.serviceId,
      deploymentId,
      serviceDescriptor, 
    });
    
    return { deploymentId };
  }
}