import { ServiceStats } from '@/types'
import { CPUUsageChart } from './cpu-usage-chart'
import { MemoryUsageChart } from './memory-usage-chart'

interface ServiceStatsProps {
  stats: ServiceStats
  className?: string
}

export function ServiceStats({ stats, className }: ServiceStatsProps) {
  return (
    <div className={`stats-grid ${className || ''}`}>
      <CPUUsageChart stats={stats} />
      <MemoryUsageChart stats={stats} />
    </div>
  )
}