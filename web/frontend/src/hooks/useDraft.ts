import { useEffect, useRef, useCallback } from 'react'

const DRAFT_KEY = 'vimax-draft'

type Draft = {
  idea: string
  style: string
  savedAt: number
}

export function useDraft(idea: string, style: string) {
  const restoredRef = useRef(false)

  // Auto-save every 3 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      if (idea.trim() || style) {
        const draft: Draft = { idea, style, savedAt: Date.now() }
        try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)) } catch {}
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [idea, style])

  // Restore draft on mount
  const restore = useCallback((): Draft | null => {
    if (restoredRef.current) return null
    restoredRef.current = true
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return null
      const draft: Draft = JSON.parse(raw)
      // Expire after 24 hours
      if (Date.now() - draft.savedAt > 86400000) {
        localStorage.removeItem(DRAFT_KEY)
        return null
      }
      return draft
    } catch {
      return null
    }
  }, [])

  // Clear draft
  const clear = useCallback(() => {
    try { localStorage.removeItem(DRAFT_KEY) } catch {}
  }, [])

  return { restore, clear }
}
