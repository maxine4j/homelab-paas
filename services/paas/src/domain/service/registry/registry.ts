import { ServiceDescriptor } from '../service-descriptor';
import { ServiceRegistryRepository } from './repository';

export interface ServiceRegistry {
  getActiveDeploymentId: (serviceId: string) => Promise<string | undefined>
  setActiveDeploymentId: (serviceId: string, deploymentId: string) => Promise<void>
  registerNewDeployment: (serviceId: string, deploymentId: string, serviceDescriptor: ServiceDescriptor) => Promise<void>
}

export const createServiceRegistry = (
  repository: ServiceRegistryRepository
): ServiceRegistry => {

  return {
    getActiveDeploymentId: async (serviceId) => {
      const record = await repository.load(serviceId);
      return record?.activeDeploymentId;
    },
    setActiveDeploymentId: async (serviceId, deploymentId) => {
      const record = await repository.load(serviceId);
      record.activeDeploymentId = deploymentId;
      await repository.save(record);
    },
    registerNewDeployment: async (serviceId, deploymentId, serviceDescriptor) => {
      const record = await repository.load(serviceId);
      record.deployments.push({
        deploymentId,
        serviceDescriptor,
      });
      await repository.save(record);
    },
  }
}
