// Mock data for development and testing
import { Service, ServiceStats, ServiceLogs, ServiceEvents } from '../types'

export const mockServices: Service[] = [
  {
    id: 'service-1',
    name: 'Web Application',
    description: 'Main web server for the application',
    status: 'running',
    type: 'web',
    port: 3000,
    healthStatus: 'healthy',
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-20T14:30:00Z',
    config: {
      port: 3000,
      environment: 'production',
      workers: 4,
    }
  },
  {
    id: 'service-2',
    name: 'API Gateway',
    description: 'API gateway handling all external requests',
    status: 'running',
    type: 'gateway',
    port: 8080,
    healthStatus: 'healthy',
    created_at: '2024-01-10T08:00:00Z',
    updated_at: '2024-01-20T15:00:00Z',
    config: {
      port: 8080,
      environment: 'production',
      routes: 15,
    }
  },
  {
    id: 'service-3',
    name: 'Database Service',
    description: 'Primary PostgreSQL database',
    status: 'running',
    type: 'database',
    port: 5432,
    healthStatus: 'healthy',
    created_at: '2024-01-08T06:00:00Z',
    updated_at: '2024-01-20T12:00:00Z',
    config: {
      port: 5432,
      environment: 'production',
      database: 'paas_db',
    }
  },
  {
    id: 'service-4',
    name: 'Redis Cache',
    description: 'In-memory cache for session data',
    status: 'stopped',
    type: 'cache',
    port: 6379,
    healthStatus: 'unknown',
    created_at: '2024-01-12T09:00:00Z',
    updated_at: '2024-01-18T10:00:00Z',
    config: {
      port: 6379,
      environment: 'production',
      maxmemory: '256mb',
    }
  },
  {
    id: 'service-5',
    name: 'Background Worker',
    description: 'Async job processing worker',
    status: 'running',
    type: 'worker',
    port: 3001,
    healthStatus: 'unhealthy',
    created_at: '2024-01-14T11:00:00Z',
    updated_at: '2024-01-20T16:00:00Z',
    config: {
      port: 3001,
      environment: 'production',
      queue: 'jobs',
    }
  },
]

export const mockServiceStats: Record<string, ServiceStats> = {
  'service-1': {
    cpu_usage: 45,
    memory_usage: 62,
    requests_total: 1543200,
    requests_per_second: 15.3,
    avg_response_time: 45,
  },
  'service-2': {
    cpu_usage: 62,
    memory_usage: 55,
    requests_total: 892100,
    requests_per_second: 8.9,
    avg_response_time: 32,
  },
  'service-3': {
    cpu_usage: 28,
    memory_usage: 78,
    requests_total: 234000,
    requests_per_second: 2.3,
    avg_response_time: 12,
  },
  'service-4': {
    cpu_usage: 0,
    memory_usage: 12,
    requests_total: 0,
    requests_per_second: 0,
    avg_response_time: 0,
  },
  'service-5': {
    cpu_usage: 72,
    memory_usage: 85,
    requests_total: 678000,
    requests_per_second: 6.7,
    avg_response_time: 78,
  },
}

export const mockServiceLogs: Record<string, ServiceLogs> = {
  'service-1': {
    service_id: 'service-1',
    logs: [
      { id: 'log-1', timestamp: '2024-01-20T16:00:00Z', level: 'info', message: 'Server started on port 3000', metadata: { workers: 4 } },
      { id: 'log-2', timestamp: '2024-01-20T16:00:01Z', level: 'info', message: 'Connected to database', metadata: { db: 'paas_db' } },
      { id: 'log-3', timestamp: '2024-01-20T16:05:00Z', level: 'warn', message: 'High memory usage detected', metadata: { usage: '62%' } },
      { id: 'log-4', timestamp: '2024-01-20T16:10:00Z', level: 'info', message: 'Request processed successfully', metadata: { path: '/api/users', status: 200 } },
      { id: 'log-5', timestamp: '2024-01-20T16:15:00Z', level: 'error', message: 'Connection timeout', metadata: { path: '/api/external' } },
    ]
  },
  'service-2': {
    service_id: 'service-2',
    logs: [
      { id: 'log-6', timestamp: '2024-01-20T16:00:00Z', level: 'info', message: 'Gateway initialized', metadata: { routes: 15 } },
      { id: 'log-7', timestamp: '2024-01-20T16:05:00Z', level: 'info', message: 'Route registered: /api/v1/users', metadata: { method: 'GET' } },
      { id: 'log-8', timestamp: '2024-01-20T16:10:00Z', level: 'info', message: 'Request forwarded', metadata: { upstream: 'service-1', status: 200 } },
      { id: 'log-9', timestamp: '2024-01-20T16:15:00Z', level: 'info', message: 'Rate limit updated', metadata: { limit: 1000, remaining: 995 } },
    ]
  },
  'service-3': {
    service_id: 'service-3',
    logs: [
      { id: 'log-10', timestamp: '2024-01-20T16:00:00Z', level: 'info', message: 'PostgreSQL started', metadata: { version: '14.7' } },
      { id: 'log-11', timestamp: '2024-01-20T16:05:00Z', level: 'info', message: 'Connection pool initialized', metadata: { min: 5, max: 20 } },
      { id: 'log-12', timestamp: '2024-01-20T16:10:00Z', level: 'info', message: 'Query executed successfully', metadata: { duration: '12ms' } },
      { id: 'log-13', timestamp: '2024-01-20T16:15:00Z', level: 'warn', message: 'Long running query detected', metadata: { query: 'SELECT * FROM large_table', duration: '500ms' } },
    ]
  },
  'service-4': {
    service_id: 'service-4',
    logs: []
  },
  'service-5': {
    service_id: 'service-5',
    logs: [
      { id: 'log-14', timestamp: '2024-01-20T16:00:00Z', level: 'info', message: 'Worker started', metadata: { queue: 'jobs' } },
      { id: 'log-15', timestamp: '2024-01-20T16:05:00Z', level: 'info', message: 'Job processed', metadata: { id: 'job-123', status: 'completed' } },
      { id: 'log-16', timestamp: '2024-01-20T16:10:00Z', level: 'info', message: 'Job failed', metadata: { id: 'job-124', status: 'failed', error: 'Timeout' } },
      { id: 'log-17', timestamp: '2024-01-20T16:15:00Z', level: 'error', message: 'Worker heartbeat missed', metadata: {} },
    ]
  },
}

export const mockServiceEvents: Record<string, ServiceEvents> = {
  'service-1': {
    service_id: 'service-1',
    events: [
      { id: 'evt-1', service_id: 'service-1', timestamp: '2024-01-20T16:00:00Z', type: 'start', description: 'Service started' },
      { id: 'evt-2', service_id: 'service-1', timestamp: '2024-01-20T16:05:00Z', type: 'deploy', description: 'Version 2.0 deployed' },
      { id: 'evt-3', service_id: 'service-1', timestamp: '2024-01-20T16:10:00Z', type: 'restart', description: 'Restarted due to high memory' },
      { id: 'evt-4', service_id: 'service-1', timestamp: '2024-01-20T16:15:00Z', type: 'error', description: 'Connection timeout error' },
    ]
  },
  'service-2': {
    service_id: 'service-2',
    events: [
      { id: 'evt-5', service_id: 'service-2', timestamp: '2024-01-20T16:00:00Z', type: 'start', description: 'Service started' },
      { id: 'evt-6', service_id: 'service-2', timestamp: '2024-01-20T16:05:00Z', type: 'deploy', description: 'Route configuration updated' },
    ]
  },
  'service-3': {
    service_id: 'service-3',
    events: [
      { id: 'evt-7', service_id: 'service-3', timestamp: '2024-01-20T16:00:00Z', type: 'start', description: 'Service started' },
      { id: 'evt-8', service_id: 'service-3', timestamp: '2024-01-20T16:05:00Z', type: 'deploy', description: 'Database schema updated' },
    ]
  },
  'service-4': {
    service_id: 'service-4',
    events: [
      { id: 'evt-9', service_id: 'service-4', timestamp: '2024-01-18T10:00:00Z', type: 'stop', description: 'Service stopped by user' },
    ]
  },
  'service-5': {
    service_id: 'service-5',
    events: [
      { id: 'evt-10', service_id: 'service-5', timestamp: '2024-01-20T16:00:00Z', type: 'start', description: 'Service started' },
      { id: 'evt-11', service_id: 'service-5', timestamp: '2024-01-20T16:05:00Z', type: 'deploy', description: 'New job queue added' },
      { id: 'evt-12', service_id: 'service-5', timestamp: '2024-01-20T16:10:00Z', type: 'error', description: 'Job processing failed' },
    ]
  },
}