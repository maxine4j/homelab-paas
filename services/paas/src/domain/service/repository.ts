import { ContextualError } from '../../util/error';

export interface ServiceRecord {
  serviceId: string
  activeDeploymentId?: string
}

export interface ServiceRepository {
  queryAllServices: () => Promise<ServiceRecord[]>,
  queryService: (serviceId: string) => Promise<ServiceRecord | undefined>,
  createService: (serviceId: string) => Promise<void>,
  setActiveDeployment: (serviceId: string, deploymentId: string) => Promise<void>
};

export const createInMemoryServiceRepository = (): ServiceRepository => {

  const store = new Map<string, ServiceRecord>();

  return {
    queryAllServices: async () => {
      return Array.from(store.values());
    },
    queryService: async (serviceId) => {
      return store.get(serviceId);
    },
    createService: async (serviceId) => {
      if (store.get(serviceId)) {
        throw new ContextualError('Cannot create service: Service already exists', { serviceId });
      }
      store.set(serviceId, {
        serviceId,
      });
    },
    setActiveDeployment: async (serviceId, deploymentId) => {
      const serviceRecord = store.get(serviceId);
      if (!serviceRecord) {
        throw new ContextualError('Cannot set active deployment: Service does not exist', { serviceId, deploymentId });
      }
      store.set(serviceId, {
        ...serviceRecord,
        activeDeploymentId: deploymentId,
      });
    },
  };
};
