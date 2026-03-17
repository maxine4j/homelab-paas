export type ServiceStatus = 'running' | 'stopped' | 'failed' | 'starting' | 'stopping'
export type HealthStatus = 'healthy' | 'unhealthy' | 'unknown'
export type ServiceType = 'web' | 'gateway' | 'database' | 'cache' | 'worker' | 'other'
export type LogLevel = 'info' | 'warn' | 'error'

export interface Service {
  id: string
  name: string
  description: string
  type: ServiceType
  status: ServiceStatus
  healthStatus: HealthStatus
  port: number
  version?: string
  image?: string
  resources?: {
    memory: number
    cpu: number
  }
  created_at: string
  updated_at: string
  config: Record<string, any>
}

export interface ServiceStats {
  cpu_usage: number
  memory_usage: number
  requests_total: number
  requests_per_second: number
  avg_response_time: number
}

export interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  message: string
  metadata?: Record<string, any>
}

export interface ServiceLogs {
  service_id: string
  logs: LogEntry[]
}

export interface ServiceEvent {
  id: string
  service_id: string
  type: 'start' | 'stop' | 'restart' | 'deploy' | 'error'
  description: string
  timestamp: string
}

export interface ServiceEvents {
  service_id: string
  events: ServiceEvent[]
}

export interface ApiResponse<T> {
  data: T
  message?: string
  error?: string
}

export interface CreateServiceRequest {
  name: string
  description: string
  type: ServiceType
  port: number
  image: string
  command?: string
  env?: Record<string, string>
}

export interface UpdateServiceRequest {
  name?: string
  description?: string
  config?: Record<string, any>
}