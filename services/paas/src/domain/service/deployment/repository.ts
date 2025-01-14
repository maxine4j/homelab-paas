import { KeyValueStore } from '../../../kv-store/types'
import { ContextualError } from '../../../util/error'
import { ServiceDescriptor } from '../service-descriptor'

interface ContainerRecord {
  hostname: string
  port: number
}

export interface DeploymentRecord {
  serviceId: string
  deploymentId: string
  createdAt: Date,
  serviceDescriptor: ServiceDescriptor
  status: 'deploying' | 'running' | 'cleaned-up' | 'failed'
  failureReason?: string
  container?: ContainerRecord
}

export interface DeploymentRepository {
  query: (deploymentId: string) => Promise<DeploymentRecord | undefined>
  queryByStatus: (status: DeploymentRecord['status']) => Promise<DeploymentRecord[]>
  queryForService: (serviceId: string) => Promise<DeploymentRecord[]>
  createDeployment: (deploymentId: string, serviceDescriptor: ServiceDescriptor) => Promise<void>
  markDeploymentRunning: (deploymentId: string, container: ContainerRecord) => Promise<void>
  markDeploymentFailed: (deploymentId: string, failureReason: string) => Promise<void>
  markDeploymentCleanedUp: (deploymentId: string) => Promise<void>
}

export const createDeploymentRepository = (
  now: () => Date,
  store: KeyValueStore<DeploymentRecord>,
): DeploymentRepository => {

  return {
    query: async (deploymentId) => {
      return store.get(deploymentId);
    },
    queryByStatus: async (status) => {
      return store.values()
        .filter(deployment => deployment.status === status);
    },
    queryForService: async (serviceId) => {
      return store.values()
        .filter(deployment => deployment.serviceId === serviceId);
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
      store.update(deploymentId, (existingDeploymentRecord) => {
        if (!existingDeploymentRecord) {
          throw new ContextualError('Failed to make deployment as running: Deployment does not exist', { deploymentId });
        }
        return {
          ...existingDeploymentRecord,
          status: 'running',
          container,
        };
      });
    },
    markDeploymentFailed: async (deploymentId, failureReason) => {
      store.update(deploymentId, (existingDeploymentRecord) => {
        if (!existingDeploymentRecord) {
          throw new ContextualError('Failed to make deployment as failed: Deployment does not exist', { deploymentId });
        }
        return {
          ...existingDeploymentRecord,
          status: 'failed',
          failureReason,
        };
      });
    },
    markDeploymentCleanedUp: async (deploymentId) => {
      store.update(deploymentId, (existingDeploymentRecord) => {
        if (!existingDeploymentRecord) {
          throw new ContextualError('Failed to make deployment as cleaned up: Deployment does not exist', { deploymentId });
        }
        
        return {
          ...existingDeploymentRecord,
          status: 'cleaned-up',
          container: undefined,
        }
      });
    }
  };
};
