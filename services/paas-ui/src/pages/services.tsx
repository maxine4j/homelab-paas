import type { Service } from '@/types'
import { Server, PlayCircle, PauseCircle, RefreshCw, Trash2 } from 'lucide-react'
import Button from '@/components/ui/button'
import Badge from '@/components/ui/badge'
import Card, { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Dialog, { DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import React, { useState } from 'react'

export default function ServicesPage() {
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false)

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Services</h1>
        <p>Manage and monitor your deployed services</p>
      </div>

      <div className="grid grid-cols-3 gap-6 mb-8">
        <Card>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Services</p>
                <p className="text-3xl font-bold">0</p>
              </div>
              <Server className="h-8 w-8 text-gray-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Running</p>
                <p className="text-3xl font-bold">0</p>
              </div>
              <PlayCircle className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Stopped</p>
                <p className="text-3xl font-bold">0</p>
              </div>
              <PauseCircle className="h-8 w-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center space-x-2">
          <input
            type="text"
            placeholder="Search services..."
            className="input"
          />
        </div>
        <Dialog open={isDeployModalOpen} onOpenChange={setIsDeployModalOpen}>
          <DialogTrigger asChild>
            <Button size="lg">
              <PlayCircle className="h-4 w-4 mr-2" />
              Deploy Service
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Deploy New Service</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Service Name</label>
                <input
                  type="text"
                  placeholder="my-service"
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Image</label>
                <input
                  type="text"
                  placeholder="nginx:latest"
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Port</label>
                <input
                  type="number"
                  placeholder="8080"
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Memory (MB)</label>
                <input
                  type="number"
                  placeholder="256"
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">CPU Cores</label>
                <input
                  type="number"
                  placeholder="0.5"
                  className="input"
                />
              </div>
              <Button className="w-full" size="lg">
                Deploy
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center space-x-2">
          <select className="select">
            <option>All Types</option>
            <option>Web</option>
            <option>Database</option>
            <option>Gateway</option>
          </select>
          <select className="select">
            <option>All Status</option>
            <option>Running</option>
            <option>Stopped</option>
          </select>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Port</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="text-gray-500">No services deployed</td>
              <td colSpan={4} className="text-center py-8 text-gray-500">
                Start by deploying your first service
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}