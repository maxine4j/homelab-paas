import { useState, useEffect } from 'react'
import type { Service, ServiceStats, ServiceLogs, ServiceEvents } from '@/types'
import { MainLayout } from '@/components/layout/main-layout'
import { ServiceStats as StatsComponent } from '@/components/stats/service-stats'
import { ServiceList } from '@/components/services/service-list'
import { LogViewer } from '@/components/logs/log-viewer'
import { EventList } from '@/components/events/event-list'
import { EmptyState } from '@/components/common/empty-state'
import { Loader } from '@/components/common/loader'
import { api } from '@/lib/api'
import { Server } from 'lucide-react'

export function Dashboard() {
  const [services, setServices] = useState<Service[]>([])
  const [stats, setStats] = useState<ServiceStats>({ cpu_usage: 0, memory_usage: 0, requests_total: 0, requests_per_second: 0, avg_response_time: 0 })
  const [_logs, setLogs] = useState<ServiceLogs>({ service_id: '', logs: [] })
  const [events, setEvents] = useState<ServiceEvents>({ service_id: '', events: [] })
  const [selectedService, _setSelectedService] = useState<Service | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [_isLogsLoading, setIsLogsLoading] = useState(false)
  const [_isEventsLoading, setIsEventsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // const [logSearchQuery, setLogSearchQuery] = useState('')

  const loadServices = async () => {
    try {
      const data = await api.getServices()
      setServices(data)
    } catch (err) {
      setError('Failed to load services')
    }
  }

  const loadStats = async (serviceId?: string) => {
    try {
      const id = serviceId || services[0]?.id
      if (id) {
        const data = await api.getServiceStats(id)
        setStats(data)
      }
    } catch (err) {
      console.error('Failed to load stats:', err)
    }
  }

  const loadLogs = async (serviceId?: string) => {
    try {
      setIsLogsLoading(true)
      const id = serviceId || selectedService?.id
      if (id) {
        const data = await api.getServiceLogs(id)
        setLogs(data)
      }
    } catch (err) {
      console.error('Failed to load logs:', err)
    } finally {
      setIsLogsLoading(false)
    }
  }

  const loadEvents = async (serviceId?: string) => {
    try {
      setIsEventsLoading(true)
      const id = serviceId || selectedService?.id
      if (id) {
        const data = await api.getServiceEvents(id)
        setEvents(data)
      }
    } catch (err) {
      console.error('Failed to load events:', err)
    } finally {
      setIsEventsLoading(false)
    }
  }

  // const handleServiceClick = async (service: Service) => {
  //   setSelectedService(service)
  //   await loadStats(service.id)
  //   await loadLogs(service.id)
  //   await loadEvents(service.id)
  // }

  useEffect(() => {
    const init = async () => {
      setIsLoading(true)
      try {
        await loadServices()
        await loadStats()
        await loadLogs()
        await loadEvents()
      } catch (err) {
        setError('Failed to initialize dashboard')
      } finally {
        setIsLoading(false)
      }
    }
    init()
  }, [])

  useEffect(() => {
    if (selectedService) {
      loadStats(selectedService.id)
      loadLogs(selectedService.id)
      loadEvents(selectedService.id)
    }
  }, [selectedService])

  if (isLoading) {
    return (
      <MainLayout>
        <div className="loader-wrapper">
          <Loader size="lg" />
        </div>
      </MainLayout>
    )
  }

  return (
    <MainLayout>
      <div className="page-content">
        <div className="page-header">
          <h1>Dashboard</h1>
          <p>Monitor and manage your PaaS services</p>
        </div>

        {error && (
          <div className="error-message">
            <p>{error}</p>
          </div>
        )}

        <StatsComponent stats={stats} />

        <div className="grid-container">
          <div className="section">
            <h2>Services</h2>
            {services.length === 0 ? (
              <EmptyState
                icon={Server}
                title="No Services"
                description="You don't have any services configured yet."
                action={{
                  label: 'Add Service',
                  onClick: () => {
                    // TODO: Implement add service dialog
                  },
                }}
              />
            ) : (
              <ServiceList
                services={services}
                // onServiceClick={handleServiceClick}
              />
            )}
          </div>

          {selectedService && (
            <div className="section section-full">
              <div className="grid-container grid-2">
                <LogViewer
                  logs={[]}
                  serviceName="foo"
                  // searchQuery={logSearchQuery}
                  // onSearchChange={setLogSearchQuery}
                />
                <EventList events={events.events} />
              </div>

              <div className="grid-container grid-3">
                <div className="stat-card">
                  <h3>CPU Usage</h3>
                  <div className="stat-value">{stats.cpu_usage}%</div>
                  <div className="progress-bar">
                    <div
                      className="progress-fill progress-blue"
                      style={{ width: `${stats.cpu_usage}%` }}
                    />
                  </div>
                </div>

                <div className="stat-card">
                  <h3>Memory Usage</h3>
                  <div className="stat-value">{stats.memory_usage}%</div>
                  <div className="progress-bar">
                    <div
                      className="progress-fill progress-purple"
                      style={{ width: `${stats.memory_usage}%` }}
                    />
                  </div>
                </div>

                <div className="stat-card">
                  <h3>Requests</h3>
                  <div className="stat-value">
                    {(stats.requests_total / 1000000).toFixed(2)}M
                  </div>
                  <p className="stat-subtitle">{stats.requests_per_second} req/s</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  )
}