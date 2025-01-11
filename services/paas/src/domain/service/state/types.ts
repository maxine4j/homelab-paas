interface MissingContainerState {
  state: 'missing',
}

interface PresentContainerState {
  state: 'healthy' | 'unhealthy' | 'pending' | 'error';
  name: string
  createdAt: Date,
  image: string,
}

export type ContainerState =
  | MissingContainerState
  | PresentContainerState

export interface DeploymentState {
  deploymentId: string
  deployedAt: Date
  state: 'active' | 'deploying' | 'stale'
  container: ContainerState
}

export interface ServiceState {
  serviceId: string
  deploymentIds: string[]
}
