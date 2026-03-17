import { Server } from 'lucide-react'
import Card, { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import React from 'react'

interface LogViewerProps {
  logs: string[]
  serviceName: string
  className?: string
}

export function LogViewer({ logs, serviceName, className }: LogViewerProps) {
  return (
    <Card className={cn('h-full', className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center space-x-2">
            <Server className="h-5 w-5" />
            <span>Logs</span>
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="log-viewer">
          <div className="log-viewer-header">
            <h3>{serviceName}</h3>
          </div>
          <div className="log-viewer-content">
            {logs.length === 0 ? (
              <div className="text-center py-4 text-gray-500">
                No logs available
              </div>
            ) : (
              logs.map((log, index) => (
                <div key={index} className="log-entry">
                  <span className="timestamp">
                    {new Date().toLocaleString()}
                  </span>
                  <span className="message">{log}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}