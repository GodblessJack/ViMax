import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { WorkArea } from '@/components/workarea/WorkArea'
import AIChatPanel from '@/components/layout/AIChatPanel'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useSessionWebSocket } from '@/hooks/useSessionWebSocket'
import { logger } from '@/lib/logger'

export default function CreateDramaPage() {
  const [searchParams] = useSearchParams()
  const sessionId = useWorkflowStore((s) => s.sessionId)
  const setSession = useWorkflowStore((s) => s.setSession)
  const goToStep = useWorkflowStore((s) => s.goToStep)

  // WebSocket connection — dispatches events into the store
  useSessionWebSocket(sessionId)

  // Session restore from URL param
  useEffect(() => {
    const sid = searchParams.get('session')
    if (!sid || sessionId) return
    import('@/lib/api').then(({ getSession }) => {
      getSession(sid).then((detail) => {
        if (!detail) return
        setSession(detail.session_id, detail.stage)
        // Map session stage to step index (0-based)
        const stageToStep: Record<string, number> = {
          created: 0,
          narrative_planning: 0,
          narrative_planned: 2,
          rendering: 4,
          rendered: 5,
          error: 0,
          cancelled: 0,
        }
        goToStep(stageToStep[detail.stage] ?? 0)
        logger.info('Session restored', { sessionId: sid, stage: detail.stage })
      }).catch((err) => {
        logger.error('Failed to restore session', err)
      })
    })
  }, [searchParams, sessionId, setSession, goToStep])

  return (
    <div className="create-drama-page flex h-[calc(100vh-4rem)]">
      {/* Left: WorkArea */}
      <div className="flex-1 min-w-0 border-r">
        <WorkArea />
      </div>
      {/* Right: AgentChat */}
      <div className="w-96 flex-shrink-0">
        <AIChatPanel />
      </div>
    </div>
  )
}
