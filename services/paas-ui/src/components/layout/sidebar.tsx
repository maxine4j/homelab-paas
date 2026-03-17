import { LayoutDashboard, Server, Activity, Settings, LogOut } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'

interface SidebarProps {
  className?: string
}

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/services', label: 'Services', icon: Server },
  { href: '/monitoring', label: 'Monitoring', icon: Activity },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar({ className }: SidebarProps) {
  const location = useLocation()

  return (
    <div className={cn('sidebar', className)}>
      <div className="sidebar-header">
        <Server className="h-6 w-6 logo-icon" />
        <span className="logo-text">PaaS Manager</span>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const isActive = location.pathname === item.href
          return (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                'nav-item',
                isActive && 'active'
              )}
            >
              <item.icon className="nav-icon" />
              <span className="nav-text">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <button>
          <LogOut className="footer-icon" />
          <span className="footer-text">Logout</span>
        </button>
      </div>
    </div>
  )
}
