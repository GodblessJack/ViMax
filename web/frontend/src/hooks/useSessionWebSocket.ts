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
import type { WsServerEvent, WsClientEvent, WorkflowStepName, PreStepConfirmData } from '@/stores/types'

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
    // Use Vite proxy in dev (handles WS correctly), direct backend in prod
    const wsHost = import.meta.env.DEV ? window.location.host : window.location.host
    const wsUrl = `${protocol}//${wsHost}/ws/session/${sid}`

    try {
      const ws = new WebSocket(wsUrl)

      let wasOpened = false

      ws.onopen = () => {
        if (!mountedRef.current) {
          ws.close()
          return
        }
        wasOpened = true
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

      ws.onclose = (e: CloseEvent) => {
        if (!mountedRef.current) return

        // If the connection never opened (e.g. Vite HMR reload killed it),
        // don't trigger the full disconnect flow — the browser already
        // logs a warning; we just retry silently.
        if (!wasOpened && retriesRef.current < MAX_RETRIES) {
          const delay = Math.min(1000 * Math.pow(2, retriesRef.current), 16000)
          timerRef.current = setTimeout(() => {
            retriesRef.current++
            connect(sid)
          }, delay)
          return
        }

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

          // ── V3: Event-specific dispatch (before generic handleWsEvent) ──
          switch (event.type) {
            case 'step:need_confirm_before': {
              const steps = useWorkflowStore.getState().steps
              const stepIdx = steps.find(s => s.name === event.step)?.index ?? 0
              const data: PreStepConfirmData = {
                stepName: event.step as WorkflowStepName,
                stepIndex: stepIdx,
                params: event.context.params,
                estimatedDuration: event.context.estimatedDuration,
                dependencies: event.context.dependencies,
                sideEffects: event.context.sideEffects,
                requestedBy: event.source,
                timestamp: Date.now(),
                timeoutMs: 1800000,
              }
              store.requestPreConfirm(data)
              break
            }
            case 'step:pre_step_context': {
              store.updateStepContext({
                currentProgress: event.currentProgress,
                availableArtifacts: event.availableArtifacts,
                agentState: event.agentState,
              })
              break
            }
            case 'sync:config_changed': {
              store.setSyncState({
                configChanges: [
                  ...useWorkflowStore.getState().syncState.configChanges,
                  ...event.changes,
                ].slice(-50),
              })
              for (const change of event.changes) {
                store.updateArtifact(change.path, change.newValue)
                // ── V3: propagate idea/style changes to store ──
                if (change.path === 'idea' || change.field === 'idea') {
                  store.setIdea(String(change.newValue ?? ''))
                }
                if (change.path === 'style' || change.field === 'style') {
                  store.setStyle(String(change.newValue ?? ''))
                }
              }
              break
            }
            case 'sync:confirmation_state': {
              store.handleSyncConfirmation(event.state)
              break
            }
          }

          // Dispatch to store for state updates (backward compat + legacy events)
          store.handleWsEvent(event)
        } catch {
          logger.warn('useSessionWebSocket: malformed message', e.data)
        }
      }

      ws.onerror = () => {
        // Suppress: onclose will fire after this.
        // The browser's built-in WebSocket error logging cannot be
        // entirely suppressed, but we avoid logging additional noise here.
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

  // ── V3: Pre-exec confirmation helpers ────────────────────────────

  const sendConfirmBefore = useCallback((step: string, reply?: string) => {
    sendEvent({
      type: 'user:confirm_before',
      session_id: sessionId || '',
      step,
      phase: 'before',
      payload: {},
      reply: reply ?? '',
    })
  }, [sendEvent, sessionId])

  const sendRejectBefore = useCallback((step: string, reply?: string, modifiedParams?: Record<string, unknown>) => {
    sendEvent({
      type: 'user:reject_before',
      session_id: sessionId || '',
      step,
      phase: 'before',
      payload: modifiedParams ?? {},
      reply: reply ?? '',
    })
  }, [sendEvent, sessionId])

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
  }, []) // mount/unmount only — do NOT re-run on store changes

  // ── Session ID changes ──────────────────────────────────────────────

  useEffect(() => {
    // Only act on sessionId transitions, not every render
    if (lastProcessedSidRef.current === sessionId) return
    const prevSid = lastProcessedSidRef.current
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
    // Only reset when switching between sessions, not on initial null→id
    if (prevSid) store.reset()
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
  // NOTE: intentionally NOT including `store` in deps — Zustand store actions
  // are stable references. Including `store` causes the cleanup to fire on
  // every Zustand update, closing the WebSocket immediately after opening.
  }, [sessionId, connect])

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
    // ── V3: Pre-exec confirmation ──────────────────────────────────
    sendConfirmBefore,
    sendRejectBefore,
  }
}
