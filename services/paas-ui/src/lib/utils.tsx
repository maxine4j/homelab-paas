import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { Server, Globe, Database, HardDrive, Activity, Cpu } from 'lucide-react'
import React from 'react'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function getTypeIcon(type: string): React.ReactNode {
  const icons = {
    web: Globe,
    gateway: Server,
    database: Database,
    cache: HardDrive,
    worker: Activity,
    other: Cpu,
  }
  const Icon = icons[type as keyof typeof icons]
  return Icon ? <Icon className="h-3 w-3" /> : <Server className="h-3 w-3" />
}
