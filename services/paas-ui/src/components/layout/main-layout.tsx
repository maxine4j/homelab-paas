import type { ReactNode } from 'react'
import { Sidebar } from './sidebar'

interface MainLayoutProps {
  children: ReactNode
  className?: string
}

export function MainLayout({ children, className }: MainLayoutProps) {
  return (
    <div className="main-layout">
      <Sidebar />
      <main className="main-content">
        <div className={className || 'page-content'}>
          {children}
        </div>
      </main>
    </div>
  )
}
