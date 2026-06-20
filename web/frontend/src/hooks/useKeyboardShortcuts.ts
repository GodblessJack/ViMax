import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

type ShortcutHandler = (e: KeyboardEvent) => void

const SHORTCUTS: Record<string, { key: string; ctrl?: boolean; meta?: boolean; description: string }> = {
  dashboard: { key: '1', ctrl: true, description: '工作台' },
  create: { key: 'n', ctrl: true, description: '创建短剧' },
  works: { key: '2', ctrl: true, description: '我的作品' },
}

export function useKeyboardShortcuts() {
  const navigate = useNavigate()

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Don't trigger when typing in inputs
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      const mod = e.ctrlKey || e.metaKey

      // Ctrl+1: Dashboard
      if (mod && e.key === '1') {
        e.preventDefault()
        navigate('/')
      }
      // Ctrl+2: Works
      if (mod && e.key === '2') {
        e.preventDefault()
        navigate('/works')
      }
      // Ctrl+N: New drama
      if (mod && e.key === 'n') {
        e.preventDefault()
        navigate('/create')
      }
      // Escape: go back
      if (e.key === 'Escape') {
        navigate(-1)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate])
}

export { SHORTCUTS }
