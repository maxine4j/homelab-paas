import { KeyValueStore } from '../../kv-store/types';
import { ContextualError } from '../../util/error';

export interface ServiceRecord {
  serviceId: string;
  activeDeploymentId?: string;
}

export class ServiceRepository {
  constructor(private readonly store: KeyValueStore<ServiceRecord>) {}

  public async queryAllServices(): Promise<ServiceRecord[]> {
    return this.store.values();
  }

  public async queryService(
    serviceId: string,
  ): Promise<ServiceRecord | undefined> {
    return this.store.get(serviceId);
  }

  public async createService(serviceId: string): Promise<void> {
    if (this.store.get(serviceId)) {
      throw new ContextualError(
        'Cannot create service: Service already exists',
        { serviceId },
      );
    }
    this.store.set(serviceId, {
      serviceId,
    });
  }

  public async setActiveDeployment(
    serviceId: string,
    deploymentId: string,
  ): Promise<void> {
    this.store.update(serviceId, (existingValue) => {
      if (!existingValue) {
        throw new ContextualError(
          'Cannot set active deployment: Service does not exist',
          { serviceId, deploymentId },
        );
      }
      return {
        ...existingValue,
        activeDeploymentId: deploymentId,
      };
    });
  }
}
