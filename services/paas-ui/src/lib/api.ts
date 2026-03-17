import type { Service, ServiceStats, ServiceLogs, ServiceEvents, CreateServiceRequest, UpdateServiceRequest, ServiceStatus } from '@/types'

const API_BASE_URL = '/api'

class APIClient {
  private baseUrl: string

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        ...options,
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      return response.json()
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new Error('An unexpected error occurred')
    }
  }

  async getServices(): Promise<Service[]> {
    return this.request<Service[]>('/services')
  }

  async getService(id: string): Promise<Service> {
    return this.request<Service>(`/services/${id}`)
  }

  async createService(data: CreateServiceRequest): Promise<Service> {
    return this.request<Service>('/services', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateService(id: string, data: UpdateServiceRequest): Promise<Service> {
    return this.request<Service>(`/services/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteService(id: string): Promise<void> {
    return this.request<void>(`/services/${id}`, {
      method: 'DELETE',
    })
  }

  async getServiceStats(id: string): Promise<ServiceStats> {
    return this.request<ServiceStats>(`/services/${id}/stats`)
  }

  async getServiceLogs(id: string, limit: number = 100): Promise<ServiceLogs> {
    return this.request<ServiceLogs>(`/services/${id}/logs?limit=${limit}`)
  }

  async getServiceEvents(id: string, limit: number = 50): Promise<ServiceEvents> {
    return this.request<ServiceEvents>(`/services/${id}/events?limit=${limit}`)
  }

  async startService(id: string): Promise<Service> {
    return this.request<Service>(`/services/${id}/start`, {
      method: 'POST',
    })
  }

  async stopService(id: string): Promise<Service> {
    return this.request<Service>(`/services/${id}/stop`, {
      method: 'POST',
    })
  }

  async restartService(id: string): Promise<Service> {
    return this.request<Service>(`/services/${id}/restart`, {
      method: 'POST',
    })
  }

  async updateServiceStatus(id: string, status: ServiceStatus): Promise<Service> {
    return this.request<Service>(`/services/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
  }

  async deployService(id: string, config: Record<string, any>): Promise<Service> {
    return this.request<Service>(`/services/${id}/deploy`, {
      method: 'POST',
      body: JSON.stringify(config),
    })
  }
}

export const api = new APIClient()