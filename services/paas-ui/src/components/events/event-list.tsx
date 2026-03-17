import type { ServiceEvent } from '@/types'
import { Clock, AlertCircle, RotateCcw, PlayCircle, PauseCircle, Rocket } from 'lucide-react'
import Card, { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Badge from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import React from 'react'

const eventColors = {
  start: 'text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400',
  stop: 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400',
  restart: 'text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400',
  deploy: 'text-purple-600 bg-purple-100 dark:bg-purple-900/30 dark:text-purple-400',
  error: 'text-orange-600 bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400',
}

const eventIcons: Record<ServiceEvent['type'], React.ReactNode> = {
  start: <PlayCircle className="h-4 w-4" />,
  stop: <PauseCircle className="h-4 w-4" />,
  restart: <RotateCcw className="h-4 w-4" />,
  deploy: <Rocket className="h-4 w-4" />,
  error: <AlertCircle className="h-4 w-4" />,
}

interface EventListProps {
  events: ServiceEvent[]
  className?: string
}

export function EventList({ events, className }: EventListProps) {
  const getEventIconComponent = (type: ServiceEvent['type']) => {
    if (type === 'deploy') {
      return <Rocket className="h-4 w-4" />
    }
    const Icon = eventIcons[type]
    if (Icon) {
      return Icon
    }
    return <Clock className="h-4 w-4" />
  }

  return (
    <Card className={cn('h-full', className)}>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Clock className="h-5 w-5" />
          <span>Events</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {events.map((event, index) => (
            <div
              key={index}
              className="rounded-lg border p-3 dark:border-gray-800"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-2">
                  {getEventIconComponent(event.type)}
                  <Badge className={cn(eventColors[event.type])}>
                    {event.type.toUpperCase()}
                  </Badge>
                </div>
                <span className="text-sm text-gray-500">
                  {new Date(event.timestamp).toLocaleString()}
                </span>
              </div>
              <p className="mt-2 text-sm">{event.description}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}