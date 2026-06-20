import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import GlobalAIPanel from './GlobalAIPanel'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { cn } from '@/lib/utils'

export default function AppShell({ children }: { children: React.ReactNode }) {
  useDocumentTitle()
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()
  const isCreateRoute = location.pathname === '/create'

  // Animate on route change
  const [displayChildren, setDisplayChildren] = useState(children)
  const [transitioning, setTransitioning] = useState(false)
  const prevPath = useRef(location.pathname)

  useEffect(() => {
    if (prevPath.current !== location.pathname) {
      setTransitioning(true)
      const timer = setTimeout(() => {
        setDisplayChildren(children)
        setTransitioning(false)
      }, 150)
      prevPath.current = location.pathname
      return () => clearTimeout(timer)
    } else {
      setDisplayChildren(children)
    }
  }, [children, location.pathname])

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />

      <main
        className={cn(
          'flex-1 overflow-auto transition-opacity duration-150',
          isCreateRoute && 'flex',
          transitioning && 'opacity-0',
        )}
      >
        {displayChildren}
      </main>

      {/* Global AI Panel — visible on Dashboard, Works, WorkDetail (not /create which has its own) */}
      {!isCreateRoute && <GlobalAIPanel />}
    </div>
  )
}
