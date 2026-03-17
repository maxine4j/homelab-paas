import type { Service } from '@/types'
import { Activity, Server, ServerCrash, Wifi, HardDrive, RefreshCw, Trash2 } from 'lucide-react'
import Card, { CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import Badge from '@/components/ui/badge'
import Button from '@/components/ui/button'
import { cn, getTypeIcon } from '@/lib/utils'
import React from 'react'

interface ServiceDetailProps {
  service: Service
  className?: string
}

export function ServiceDetail({ service, className }: ServiceDetailProps) {
  return (
    <div className={cn('space-y-6', className)}>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>{service.name}</CardTitle>
              <p className="text-gray-500 mt-2">{service.description}</p>
            </div>
            <div>
              <Badge className={cn(
                service.status === 'running' ? 'badge-success' : 
                service.status === 'stopped' ? 'badge-warning' : 'badge-danger'
              )}>
                {service.status}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-3">Service Information</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">ID</span>
                  <span className="text-sm font-mono">{service.id}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Type</span>
                  <span className="text-sm">{service.type}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Version</span>
                  <span className="text-sm">{service.version}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Status</span>
                  <span className="text-sm">{service.status}</span>
                </div>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-3">Configuration</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Port</span>
                  <span className="text-sm font-mono">{service.port}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Memory</span>
                  <span className="text-sm">{service.resources?.memory || 'N/A'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">CPU</span>
                  <span className="text-sm">{service.resources?.cpu || 'N/A'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Image</span>
                  <span className="text-sm font-mono text-xs">{service.image}</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Restart
          </Button>
          <Button variant="outline" size="sm">
            <Activity className="h-4 w-4 mr-2" />
            View Logs
          </Button>
          <Button variant="danger" size="sm">
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </CardFooter>
      </Card>

      <div className="grid grid-cols-3 gap-6">
        <Card className="col-span-2">
          <CardHeader>
            <CardTitle>Usage Statistics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">CPU Usage</span>
                  <span className="text-sm">45%</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: '45%' }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Memory Usage</span>
                  <span className="text-sm">128MB / 256MB</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-purple-500 rounded-full" style={{ width: '50%' }} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Service Info</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Server className="h-5 w-5 text-gray-500" />
                <div>
                  <p className="text-sm text-gray-500">Type</p>
                  <p className="font-medium">{service.type}</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Wifi className="h-5 w-5 text-gray-500" />
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  <p className="font-medium">{service.status}</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <HardDrive className="h-5 w-5 text-gray-500" />
                <div>
                  <p className="text-sm text-gray-500">Version</p>
                  <p className="font-medium">{service.version}</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Activity className="h-5 w-5 text-gray-500" />
                <div>
                  <p className="text-sm text-gray-500">Replicas</p>
                  <p className="font-medium">1</p>
                </div>
              </div>
              {service.status === 'stopped' && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <p className="text-sm text-red-600 dark:text-red-400">
                    This service is not running. Please start it to use it.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}