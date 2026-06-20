import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Video, FolderOpen, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: '工作台' },
  { to: '/create', icon: Video, label: '创建短剧' },
  { to: '/works', icon: FolderOpen, label: '我的作品' },
]

export default function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside className={cn(
      'flex flex-col border-r bg-sidebar text-sidebar-foreground transition-all duration-200',
      collapsed ? 'w-14' : 'w-48'
    )}>
      <div className="flex h-14 items-center justify-center border-b px-2">
        {!collapsed && <span className="font-bold text-sm">ViMax</span>}
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => cn(
              'flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-sidebar-accent',
              isActive && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium',
              collapsed && 'justify-center'
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>
      <button
        onClick={onToggle}
        className="flex h-10 items-center justify-center border-t text-muted-foreground hover:text-foreground"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>
    </aside>
  )
}
