import { useEffect, useRef, useState, useCallback } from 'react'
import type { PipelineEvent } from '@/lib/types'
import { useWorkflowStore } from '@/stores/workflowStore'

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

/**
 * @deprecated Use {@link useSessionWebSocket} from `@/hooks/useSessionWebSocket` instead.
 * This hook is no longer imported by any component and is kept only for reference.
 */
export function usePipelineWebSocket(sessionId: string | null) {
  const [events, setEvents] = useState<PipelineEvent[]>([])
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const wsRef = useRef<WebSocket | null>(null)
  const retriesRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const maxRetries = 5

  const connect = useCallback((sid: string) => {
    if (!mountedRef.current) return
    if (retriesRef.current >= maxRetries) {
      setConnectionState('disconnected')
      return
    }

    if (retriesRef.current > 0) {
      setConnectionState('reconnecting')
    } else {
      setConnectionState('connecting')
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/pipeline/${sid}`

    try {
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return }
        retriesRef.current = 0
        setConnectionState('connected')
      }

      ws.onclose = () => {
        if (!mountedRef.current) return
        setConnectionState('disconnected')
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s
        if (retriesRef.current < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, retriesRef.current), 16000)
          timerRef.current = setTimeout(() => {
            retriesRef.current++
            connect(sid)
          }, delay)
        }
      }

      ws.onmessage = (e) => {
        if (!mountedRef.current) return
        try {
          const event = JSON.parse(e.data) as PipelineEvent
          setEvents((prev) => [...prev, event])
        } catch { /* Ignore malformed events */ }
      }

      ws.onerror = () => {
        // onclose will fire after this
      }

      wsRef.current = ws
    } catch {
      // Construction failed — will retry through onclose logic
      if (mountedRef.current) {
        const delay = Math.min(1000 * Math.pow(2, retriesRef.current), 16000)
        timerRef.current = setTimeout(() => {
          retriesRef.current++
          connect(sid)
        }, delay)
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (wsRef.current) {
        wsRef.current.onclose = null // prevent reconnect on intentional close
        wsRef.current.close()
        wsRef.current = null
      }
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!sessionId) {
      setEvents([])
      setConnectionState('disconnected')
      retriesRef.current = 0
      return
    }

    retriesRef.current = 0
    setEvents([])
    connect(sessionId)

    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
        wsRef.current = null
      }
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [sessionId, connect])

  const clearEvents = useCallback(() => setEvents([]), [])

  return { events, connected: connectionState === 'connected', connectionState, clearEvents }
}
