import { useEffect, useRef, useState, useCallback } from 'react'
import type { PipelineEvent } from '@/lib/types'

const MAX_RECONNECT_DELAY = 30_000
const INITIAL_RECONNECT_DELAY = 1_000

export function usePipelineWebSocket(sessionId: string | null) {
  const [events, setEvents] = useState<PipelineEvent[]>([])
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryCountRef = useRef(0)
  const mountedRef = useRef(true)

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY * Math.pow(2, retryCountRef.current),
      MAX_RECONNECT_DELAY,
    )
    retryCountRef.current += 1
    reconnectTimerRef.current = setTimeout(() => {
      if (mountedRef.current) {
        // Connect via a fresh WebSocket — avoids stale closure issues
        connectWs()
      }
    }, delay)
    // scheduleReconnect intentionally has no dependencies — it uses refs for state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Standalone connect function (not useCallback) to avoid declaration ordering issues
  function connectWs() {
    if (!sessionId || !mountedRef.current) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/pipeline/${sessionId}`
    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      if (mountedRef.current) {
        setConnected(true)
        retryCountRef.current = 0
      }
    }

    ws.onclose = () => {
      if (mountedRef.current) {
        setConnected(false)
        scheduleReconnect()
      }
    }

    ws.onerror = () => {
      if (mountedRef.current) setConnected(false)
    }

    ws.onmessage = (e) => {
      if (!mountedRef.current) return
      try {
        const event = JSON.parse(e.data) as PipelineEvent
        setEvents((prev) => [...prev, event])
      } catch {
        // Ignore malformed events
      }
    }

    wsRef.current = ws
  }

  useEffect(() => {
    mountedRef.current = true
    retryCountRef.current = 0
    // Clear stale events when sessionId changes — intentional side-effect
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEvents([])
    connectWs()
    return () => {
      mountedRef.current = false
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const clearEvents = useCallback(() => setEvents([]), [])

  return { events, connected, clearEvents }
}
