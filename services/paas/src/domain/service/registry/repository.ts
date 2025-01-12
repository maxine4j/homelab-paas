import { ServiceDescriptor } from '../service-descriptor'

interface ServiceRegistryRecord {
  serviceId: string
  activeDeploymentId?: string
  deployments: Array<{
    deploymentId: string
    serviceDescriptor: ServiceDescriptor
  }>
}

export interface ServiceRegistryRepository {
  loadAll: () => Promise<ServiceRegistryRecord[]>
  load: (serviceId: string) => Promise<ServiceRegistryRecord>
  save: (entry: ServiceRegistryRecord) => Promise<void>
}

export const createInMemoryServiceRegistryRepository = (): ServiceRegistryRepository => {

  const store = new Map<string, ServiceRegistryRecord>();

  const defaultRecord = (serviceId: string): ServiceRegistryRecord => ({
    serviceId,
    deployments: []
  })

  return {
    loadAll: async () => Array.from(store.values()),
    load: async (serviceId) => store.get(serviceId) ?? defaultRecord(serviceId),
    save: async (state) => { store.set(state.serviceId, state) },
  }
}
