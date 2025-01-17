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

export class DeploymentRepository {

  constructor (
    private readonly now: () => Date,
    private readonly store: KeyValueStore<DeploymentRecord>,
  ) {}

  public async query(deploymentId: string): Promise<DeploymentRecord | undefined> {
    return this.store.get(deploymentId);
  }

  public async queryByStatus(status: DeploymentRecord['status']): Promise<DeploymentRecord[]> {
    return this.store.values()
      .filter(deployment => deployment.status === status);
  }

  public async queryForService(serviceId: string) {
    return this.store.values()
      .filter(deployment => deployment.serviceId === serviceId);
  }

  public async createDeployment(deploymentId: string, serviceDescriptor: ServiceDescriptor): Promise<void> {
    this.store.set(deploymentId, {
      serviceId: serviceDescriptor.serviceId,
      deploymentId,
      serviceDescriptor,
      createdAt: this.now(),
      status: 'deploying',
    });
  }

  public async markDeploymentRunning(deploymentId: string, container: ContainerRecord): Promise<void> {
    this.store.update(deploymentId, (existingDeploymentRecord) => {
      if (!existingDeploymentRecord) {
        throw new ContextualError('Failed to make deployment as running: Deployment does not exist', { deploymentId });
      }
      return {
        ...existingDeploymentRecord,
        status: 'running',
        container,
      };
    });
  }

  public async markDeploymentFailed(deploymentId: string, failureReason: string): Promise<void> {
    this.store.update(deploymentId, (existingDeploymentRecord) => {
      if (!existingDeploymentRecord) {
        throw new ContextualError('Failed to make deployment as failed: Deployment does not exist', { deploymentId });
      }
      return {
        ...existingDeploymentRecord,
        status: 'failed',
        failureReason,
      };
    });
  }

  public async markDeploymentCleanedUp(deploymentId: string): Promise<void> {
    this.store.update(deploymentId, (existingDeploymentRecord) => {
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
}
