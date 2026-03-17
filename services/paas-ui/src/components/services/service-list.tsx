import type { Service } from '@/types'
import { Server } from 'lucide-react'
import Card, { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Badge from '@/components/ui/badge'
import { cn, getTypeIcon } from '@/lib/utils'
import React from 'react'

interface ServiceListProps {
  services: Service[]
  className?: string
}

export function ServiceList({ services, className }: ServiceListProps) {
  return (
    <div className={cn('space-y-4', className)}>
      {services.length === 0 ? (
        <div className="empty-state">
          <Server className="empty-state-icon" />
          <h2 className="empty-state-title">No Services</h2>
          <p className="empty-state-description">
            You haven't deployed any services yet. Start by deploying your first application.
          </p>
          <button className="empty-state-action">
            Deploy Service
          </button>
        </div>
      ) : (
        <div className="services-grid">
          {services.map((service) => (
            <Card 
              key={service.id} 
              className="service-card"
              onClick={() => window.location.href = `/services/${service.id}`}
            >
              <CardHeader className="service-card-header">
                <CardTitle className="service-card-title">{service.name}</CardTitle>
                <div className="service-card-actions">
                  <Badge className={cn(
                    service.status === 'running' ? 'badge-success' : 
                    service.status === 'stopped' ? 'badge-warning' : 'badge-danger'
                  )}>
                    {service.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="service-card-description">{service.description}</p>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-sm text-gray-500">{service.type}</span>
                  {getTypeIcon(service.type)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}