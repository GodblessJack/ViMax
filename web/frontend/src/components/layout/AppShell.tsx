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

  // Auto-collapse sidebar on narrow viewports
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const update = (e: MediaQueryListEvent | MediaQueryList) => setCollapsed(e.matches)
    update(mq)
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // Animate on route change
  const [displayChildren, setDisplayChildren] = useState(children)
  const [transitioning, setTransitioning] = useState(false)
  const prevPath = useRef(location.pathname)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Clear any pending timer from a previous transition
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (prevPath.current !== location.pathname) {
      setTransitioning(true)
      timerRef.current = setTimeout(() => {
        setDisplayChildren(children)
        setTransitioning(false)
        timerRef.current = null
      }, 150)
      prevPath.current = location.pathname
    } else {
      setDisplayChildren(children)
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
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
