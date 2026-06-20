import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Video, FolderOpen, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { listSessions } from '@/lib/api'
import { useEffect, useState } from 'react'

const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: '工作台', shortcut: '⌘1' },
  { to: '/create', icon: Video, label: '创建短剧', shortcut: '⌘N' },
  { to: '/works', icon: FolderOpen, label: '我的作品', shortcut: '⌘2' },
]

export default function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  useKeyboardShortcuts()
  const [activeCount, setActiveCount] = useState(0)

  useEffect(() => {
    async function check() {
      try {
        const res = await listSessions({ limit: 50 })
        const active = res.items.filter(
          s => s.stage === 'narrative_planning' || s.stage === 'narrative_planned' || s.stage === 'rendering',
        )
        setActiveCount(active.length)
      } catch { /* ignore */ }
    }
    check()
    const timer = setInterval(check, 30000) // poll every 30s
    return () => clearInterval(timer)
  }, [])

  return (
    <aside className={cn(
      'flex flex-col border-l border-r bg-sidebar text-sidebar-foreground transition-all duration-300 ease-in-out',
      collapsed ? 'w-[52px]' : 'w-[200px]',
    )}>
      {/* Logo */}
      <div className="flex h-14 items-center justify-center border-b px-2 shrink-0">
        {collapsed ? (
          <span className="font-bold text-base text-primary">V</span>
        ) : (
          <span className="font-bold text-base tracking-tight">
            <span className="text-primary">Vi</span>Max
          </span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 p-2">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) => cn(
              'flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm transition-all duration-150 group relative',
              'hover:bg-sidebar-accent',
              isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-sm'
                : 'text-sidebar-foreground/70',
              collapsed && 'justify-center px-2',
              // Active indicator bar on left edge in collapsed mode
              collapsed && isActive && 'border-l-[3px] border-l-primary rounded-l-none pl-[5px]',
            )}
          >
            <item.icon className={cn('h-[18px] w-[18px] shrink-0', collapsed && 'h-5 w-5')} />
            {!collapsed ? (
              <>
                <span className="flex-1">{item.label}</span>
                {item.to === '/' && activeCount > 0 && (
                  <span className="flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-primary text-[10px] font-bold text-primary-foreground px-1">
                    {activeCount}
                  </span>
                )}
                <kbd className="opacity-0 group-hover:opacity-100 transition-opacity">
                  {item.shortcut}
                </kbd>
              </>
            ) : (
              item.to === '/' && activeCount > 0 && (
                <span className="absolute top-0.5 right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground">
                  {activeCount}
                </span>
              )
            )}
          </NavLink>
        ))}
      </nav>

      {/* Bottom controls */}
      <div className="border-t">
        {!collapsed && (
          <div className="px-2 pt-2">
            <ThemeToggle />
          </div>
        )}
        <button
          onClick={onToggle}
          className={cn(
            'flex h-10 items-center justify-center text-muted-foreground/50 hover:text-foreground transition-colors w-full',
            collapsed && 'pt-2',
          )}
        >
          {collapsed
            ? <ChevronRight className="h-4 w-4" />
            : <ChevronLeft className="h-4 w-4" />
          }
        </button>
      </div>
    </aside>
  )
}
