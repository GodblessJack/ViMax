// ── Unified Session WebSocket Hook ──────────────────────────────────────
// Bidirectional events with auto-reconnect and WorkflowStore integration.
//
// Follows the existing usePipelineWebSocket pattern from useWebSocket.ts
// but adds:
//   - sendEvent() for client→server events
//   - Event-type-aware dispatch to WorkflowStore
//   - Dedicated /ws/session/{sessionId} endpoint
//
// Usage:
//   const { connected, connectionState, sendEvent, events } = useSessionWebSocket(sessionId)

import { useEffect, useRef, useCallback } from 'react'
import { useWorkflowStore } from '@/stores/workflowStore'
import { logger } from '@/lib/logger'
import type { WsServerEvent, WsClientEvent } from '@/stores/types'

// ── Constants ────────────────────────────────────────────────────────────

const MAX_RETRIES = 5
const PING_INTERVAL_MS = 25_000 // 25 seconds — below the 30s LB idle timeout
const MAX_EVENTS = 500 // Cap stored events to avoid memory leaks

// ── Hook ────────────────────────────────────────────────────────────────

export function useSessionWebSocket(sessionId: string | null) {
  const store = useWorkflowStore()

  // Refs for WebSocket lifecycle
  const wsRef = useRef<WebSocket | null>(null)
  const retriesRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)
  const sessionIdRef = useRef<string | null>(null)
  const lastProcessedSidRef = useRef<string | null | undefined>(undefined) // tracks last processed sessionId to avoid reset loops

  // ── Connect ─────────────────────────────────────────────────────────
  const connect = useCallback((sid: string) => {
    if (!mountedRef.current) return

    if (retriesRef.current >= MAX_RETRIES) {
      store.setConnectionState('disconnected')
      logger.warn('useSessionWebSocket: max retries reached', { sessionId: sid })
      return
    }

    if (retriesRef.current > 0) {
      store.setConnectionState('reconnecting')
    } else {
      store.setConnectionState('connecting')
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/session/${sid}`

    try {
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        if (!mountedRef.current) {
          ws.close()
          return
        }
        retriesRef.current = 0
        sessionIdRef.current = sid
        store.setConnectionState('connected')
        logger.ws('rx', 'connected', { sessionId: sid })

        // Wire WS send function into store so any component can send messages
        store.setWsSendFn((event: WsClientEvent) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(event))
          }
        })

        // Start ping interval
        if (pingTimerRef.current) clearInterval(pingTimerRef.current)
        pingTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' } satisfies WsClientEvent))
          }
        }, PING_INTERVAL_MS)
      }

      ws.onclose = () => {
        if (!mountedRef.current) return
        store.setWsSendFn(null)
        store.setConnectionState('disconnected')
        if (pingTimerRef.current) {
          clearInterval(pingTimerRef.current)
          pingTimerRef.current = null
        }
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s
        if (retriesRef.current < MAX_RETRIES) {
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
          const raw = JSON.parse(e.data)
          if (!raw || typeof raw !== 'object' || !('type' in raw)) {
            console.warn('[useSessionWebSocket] Invalid event shape:', raw)
            return
          }
          const event = raw as WsServerEvent
          logger.ws('rx', event.type, event)

          // Dispatch to store for state updates
          store.handleWsEvent(event)
        } catch {
          logger.warn('useSessionWebSocket: malformed message', e.data)
        }
      }

      ws.onerror = () => {
        // onclose will fire after this
      }

      wsRef.current = ws
    } catch (err) {
      // Construction failed — retry
      logger.warn('useSessionWebSocket: WS construction failed', err)
      if (mountedRef.current) {
        const delay = Math.min(1000 * Math.pow(2, retriesRef.current), 16000)
        timerRef.current = setTimeout(() => {
          retriesRef.current++
          connect(sid)
        }, delay)
      }
    }
  }, [store])

  // ── Send event (client → server) ────────────────────────────────────
  const sendEvent = useCallback((event: WsClientEvent) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logger.warn('useSessionWebSocket: cannot send, WS not open', event.type)
      return
    }
    try {
      const payload = JSON.stringify(event)
      ws.send(payload)
      logger.ws('tx', event.type, event)
    } catch (err) {
      logger.error('useSessionWebSocket: send failed', err)
    }
  }, [])

  // ── Convenience send helpers ────────────────────────────────────────

  const sendConfirm = useCallback((step: string) => {
    sendEvent({ type: 'user:confirm', step })
  }, [sendEvent])

  const sendModify = useCallback((step: string, changes: Record<string, unknown>, feedback?: string) => {
    sendEvent({ type: 'user:modify', step, changes, feedback })
  }, [sendEvent])

  const sendRegenerate = useCallback((step: string, feedback?: string) => {
    sendEvent({ type: 'user:regenerate', step, feedback })
  }, [sendEvent])

  const sendNavigate = useCallback((targetStep: string) => {
    sendEvent({ type: 'user:navigate', target_step: targetStep })
  }, [sendEvent])

  const sendMessage = useCallback((text: string, context?: { current_step?: string; referenced_artifact?: string }) => {
    sendEvent({ type: 'user:message', text, context })
  }, [sendEvent])

  const sendAction = useCallback((action: string, payload?: unknown) => {
    sendEvent({ type: 'user:action', action, payload })
  }, [sendEvent])

  // ── Lifecycle: mount / unmount ──────────────────────────────────────

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
      if (pingTimerRef.current) clearInterval(pingTimerRef.current)
      retriesRef.current = 0
    }
  }, [store])

  // ── Session ID changes ──────────────────────────────────────────────

  useEffect(() => {
    // Only act on sessionId transitions, not every render
    if (lastProcessedSidRef.current === sessionId) return
    lastProcessedSidRef.current = sessionId

    if (!sessionId) {
      // Clear state when session is null
      store.reset()
      store.setConnectionState('disconnected')
      retriesRef.current = 0
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
        wsRef.current = null
      }
      if (timerRef.current) clearTimeout(timerRef.current)
      if (pingTimerRef.current) clearInterval(pingTimerRef.current)
      return
    }

    retriesRef.current = 0
    store.reset()
    connect(sessionId)

    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
        wsRef.current = null
      }
      if (timerRef.current) clearTimeout(timerRef.current)
      if (pingTimerRef.current) clearInterval(pingTimerRef.current)
    }
  }, [sessionId, connect, store])

  // ── Public API ──────────────────────────────────────────────────────

  const connectionState = useWorkflowStore((s) => s.connectionState)
  const connected = connectionState === 'connected'
  const events = useWorkflowStore((s) => s.events)

  return {
    connected,
    connectionState,
    events,
    sendEvent,
    sendConfirm,
    sendModify,
    sendRegenerate,
    sendNavigate,
    sendMessage,
    sendAction,
  }
}
