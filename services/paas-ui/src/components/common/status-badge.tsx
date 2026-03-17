import type { ServiceStatus, HealthStatus } from '@/types'
import Badge from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface StatusBadgeProps {
  status?: ServiceStatus | HealthStatus
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const colors = {
    running: 'text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400',
    stopped: 'text-gray-600 bg-gray-100 dark:bg-gray-900/30 dark:text-gray-400',
    failed: 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400',
    starting: 'text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400',
    stopping: 'text-orange-600 bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400',
    healthy: 'text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400',
    unhealthy: 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400',
    unknown: 'text-gray-600 bg-gray-100 dark:bg-gray-900/30 dark:text-gray-400',
  }

  if (!status) return null

  return (
    <Badge className={cn(colors[status], className)}>
      {status}
    </Badge>
  )
}