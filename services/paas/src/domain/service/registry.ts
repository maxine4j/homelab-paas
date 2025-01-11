import { ServiceDescriptor } from './service-descriptor'

interface ServiceRegistryRecord {
  serviceId: string
  deployments: Array<{
    deploymentId: string
    serviceDescriptor: ServiceDescriptor
  }>
}

export interface ServiceRegistry {
  loadAll: () => Promise<ServiceRegistryRecord[]>
  load: (serviceId: string) => Promise<ServiceRegistryRecord | undefined>
  save: (entry: ServiceRegistryRecord) => Promise<void>
}

export const createInMemoryServiceRegistry = (): ServiceRegistry => {

  const store = new Map<string, ServiceRegistryRecord>();

  return {
    loadAll: async () => Array.from(store.values()),
    load: async (serviceId) => store.get(serviceId),
    save: async (state) => { store.set(state.serviceId, state) },
  }
}
