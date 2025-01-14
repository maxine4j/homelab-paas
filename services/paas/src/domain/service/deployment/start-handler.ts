import { TaskQueue } from '../../../task/queue'
import { ServiceDescriptor } from '../service-descriptor'
import { DeploymentDeployTask } from './deploy-task'

export interface StartDeploymentHandler {
  (serviceDescriptor: ServiceDescriptor): Promise<{ deploymentId: string }>
}

export const createDeploymentStartHandler = (
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
      return { deploymentId };
    };
