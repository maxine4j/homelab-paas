import { ServiceDescriptor } from '../service-descriptor';
import { ServiceRegistryRepository } from './repository';

interface ServiceDeployment {
  serviceId: string
  deploymentId: string
  serviceDescriptor: ServiceDescriptor
  container: {
    hostname: string
    port: number
  }
}

export interface ServiceRegistry {
  getActiveDeployment: (serviceId: string) => Promise<ServiceDeployment | undefined>
  setActiveDeploymentId: (serviceId: string, deploymentId: string) => Promise<void>
  registerNewDeployment: (serviceId: string, deploymentId: string, serviceDescriptor: ServiceDescriptor) => Promise<void>
}

export const createServiceRegistry = (
  repository: ServiceRegistryRepository
): ServiceRegistry => {

  return {
    getActiveDeployment: async (serviceId) => {
      const record = await repository.load(serviceId);
      const activeDeployment = record.deployments.find(deployment => deployment.deploymentId === record.activeDeploymentId);
      if (!activeDeployment) {
        return;
      }

      return {
        serviceId,
        deploymentId: activeDeployment.deploymentId,
        serviceDescriptor: activeDeployment?.serviceDescriptor,
        container: {
          hostname: `${serviceId}-${record.activeDeploymentId}`,
          port: activeDeployment?.serviceDescriptor.containerPort ?? 8080,
        }
      }
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
