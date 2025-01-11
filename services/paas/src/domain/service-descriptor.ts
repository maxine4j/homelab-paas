export interface ServiceDescriptor {
  serviceId: string
  resources: ServiceResource[]
}

export type ServiceResource =
  | WebServerServiceResource

export interface WebServerServiceResource {
  type: 'WebServer'
  name: string
  image: {
    registry?: string
    repository: string
    tag: string
  }
}
