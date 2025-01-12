import { TaskQueue } from '../../tasks/queue'
import { ServiceDescriptor } from '../service/service-descriptor'
import { DeploymentDeployTask } from './deploy-task'

export interface StartDeploymentHandler {
  (serviceDescriptor: ServiceDescriptor): Promise<string>
}

export const createStartDeploymentHandler = (
  generateDeploymentId: () => string,
  deploymentTaskQueue: TaskQueue<DeploymentDeployTask>
): StartDeploymentHandler =>
    async (serviceDescriptor) => {
      const deploymentId = generateDeploymentId();
      await deploymentTaskQueue.enqueue({
        serviceId: serviceDescriptor.serviceId,
        deploymentId,
        serviceDescriptor, 
      });
      return deploymentId;
    };
