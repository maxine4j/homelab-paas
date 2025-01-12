import { ContextualError } from '../../util/error'
import { ServiceDescriptor } from '../service/service-descriptor'

interface ContainerRecord {
  hostname: string
  port: number
}

export interface DeploymentRecord {
  serviceId: string
  deploymentId: string
  createdAt: Date,
  serviceDescriptor: ServiceDescriptor
  status: 'deploying' | 'running' | 'cleaned-up'
  container?: ContainerRecord
}

export interface DeploymentRepository {
  query: (deploymentId: string) => Promise<DeploymentRecord | undefined>
  queryByStatus: (status: DeploymentRecord['status']) => Promise<DeploymentRecord[]>
  queryForService: (serviceId: string) => Promise<DeploymentRecord[]>
  createDeployment: (deploymentId: string, serviceDescriptor: ServiceDescriptor) => Promise<void>
  markDeploymentRunning: (deploymentId: string, container: ContainerRecord) => Promise<void>
  markDeploymentCleanedUp: (deploymentId: string) => Promise<void>
}

export const createInMemoryDeploymentRepository = (
  now: () => Date,
): DeploymentRepository => {

  const store = new Map<string, DeploymentRecord>();

  return {
    query: async (deploymentId) => {
      return store.get(deploymentId);
    },
    queryByStatus: async (status) => {
      const deployments = Array.from(store.values());
      return deployments.filter(deployment => deployment.status === status);
    },
    queryForService: async (serviceId) => {
      const deployments = Array.from(store.values());
      return deployments.filter(deployment => deployment.serviceId === serviceId);
    },
    createDeployment: async (deploymentId, serviceDescriptor) => {
      store.set(deploymentId, {
        serviceId: serviceDescriptor.serviceId,
        deploymentId,
        serviceDescriptor,
        createdAt: now(),
        status: 'deploying',
      });
    },
    markDeploymentRunning: async (deploymentId, container) => {
      const deployment = store.get(deploymentId);
      if (!deployment) {
        throw new ContextualError('Failed to make deployment as running: Deployment does not exist', { deploymentId });
      }
      store.set(deploymentId, {
        ...deployment,
        status: 'running',
        container,
      });
    },
    markDeploymentCleanedUp: async (deploymentId) => {
      const deployment = store.get(deploymentId);
      if (!deployment) {
        throw new ContextualError('Failed to make deployment as cleaned up: Deployment does not exist', { deploymentId });
      }
      store.set(deploymentId, {
        ...deployment,
        status: 'cleaned-up',
        container: undefined,
      });
    }
  };
};
