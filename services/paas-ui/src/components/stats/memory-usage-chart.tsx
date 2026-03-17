import { ServiceStats } from '@/types'
import { HardDrive } from 'lucide-react'
import Card, { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface MemoryUsageChartProps {
  stats: ServiceStats
  className?: string
}

export function MemoryUsageChart({ stats, className }: MemoryUsageChartProps) {
  return (
    <Card className={cn('h-full', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Memory Usage</CardTitle>
        <HardDrive className="h-4 w-4 text-gray-500" />
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Current Usage</span>
            <span className="text-2xl font-bold">{stats.memory_usage}%</span>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
            <div
              className="h-full rounded-full bg-purple-600 transition-all duration-500"
              style={{ width: `${stats.memory_usage}%` }}
            />
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Total Requests</p>
              <p className="font-semibold">{(stats.requests_total / 1000000).toFixed(2)}M</p>
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