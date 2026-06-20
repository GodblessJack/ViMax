import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme } from './ThemeProvider'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  const next: Record<string, { icon: typeof Sun; label: string; value: 'light' | 'dark' | 'system' }> = {
    light: { icon: Moon, label: '切换暗色模式', value: 'dark' },
    dark: { icon: Sun, label: '切换亮色模式', value: 'light' },
    system: { icon: Monitor, label: '跟随系统', value: 'system' },
  }

  function cycle() {
    const order: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system']
    const idx = order.indexOf(theme === 'system' ? 'system' : theme)
    setTheme(order[(idx + 1) % order.length])
  }

  const current = theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : 'system'
  const { icon: Icon, label } = next[current === 'system' ? 'system' : current] || next.light

  return (
    <button
      onClick={cycle}
      className="rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
      title={label}
    >
      {theme === 'dark' ? <Moon className="h-4 w-4" /> :
       theme === 'light' ? <Sun className="h-4 w-4" /> :
       <Monitor className="h-4 w-4" />}
    </button>
  )
}
