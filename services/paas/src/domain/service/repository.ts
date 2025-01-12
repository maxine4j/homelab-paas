import { createInMemoryKeyValueStore } from '../../kv-store/in-memory';
import { KeyValueStore } from '../../kv-store/types';
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

export const createServiceRepository = (
  store: KeyValueStore<ServiceRecord>
): ServiceRepository => {

  return {
    queryAllServices: async () => {
      return store.values();
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
      store.update(serviceId, (existingValue) => {
        if (!existingValue) {
          throw new ContextualError('Cannot set active deployment: Service does not exist', { serviceId, deploymentId });
        }
        return {
          ...existingValue,
          activeDeploymentId: deploymentId,
        }
      });
    },
  };
};
