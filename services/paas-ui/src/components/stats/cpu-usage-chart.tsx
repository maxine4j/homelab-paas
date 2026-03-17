import { ServiceStats } from '@/types'
import { Activity } from 'lucide-react'
import Card, { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface CPUUsageChartProps {
  stats: ServiceStats
  className?: string
}

export function CPUUsageChart({ stats, className }: CPUUsageChartProps) {
  return (
    <Card className={cn('h-full', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">CPU Usage</CardTitle>
        <Activity className="h-4 w-4 text-gray-500" />
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Current Usage</span>
            <span className="text-2xl font-bold">{stats.cpu_usage}%</span>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-500"
              style={{ width: `${stats.cpu_usage}%` }}
            />
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Requests/sec</p>
              <p className="font-semibold">{stats.requests_per_second.toFixed(1)}</p>
            </div>
            <div>
              <p className="text-gray-500">Avg Response</p>
              <p className="font-semibold">{stats.avg_response_time}ms</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}