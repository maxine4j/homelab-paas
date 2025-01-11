import { DockerRunService } from '../../docker/run'
import { ServiceDescriptor, ServiceResource } from '../service-descriptor'

export interface DeployCommandHandler {
  (serviceDescriptor: ServiceDescriptor): Promise<void>
}

export const createDeployCommandHandler = (
  dockerRun: DockerRunService
): DeployCommandHandler => {

  const deployResource = async (resource: ServiceResource) => {
    await dockerRun({
      image: `${resource.image.repository}:${resource.image.tag}`
    });
  }

  return async (serviceDescriptor) => {
    await Promise.all(serviceDescriptor.resources.map(deployResource));
  };
};
