import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import { cn } from '@/lib/utils'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()
  const isCreateRoute = location.pathname === '/create'

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      <main className={cn('flex-1 overflow-auto', isCreateRoute && 'flex')}>
        {children}
      </main>
    </div>
  )
}
