import { useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { WorkArea } from '@/components/workarea/WorkArea'
import AIChatPanel from '@/components/layout/AIChatPanel'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useSessionWebSocket } from '@/hooks/useSessionWebSocket'
import { getSession, request } from '@/lib/api'
import { logger } from '@/lib/logger'
import type { WizardStep } from '@/lib/types'

export default function CreateDramaPage() {
  const [searchParams] = useSearchParams()
  const sessionId = useWorkflowStore((s) => s.sessionId)
  const wizardStep = useWorkflowStore((s) => s.wizardStep)
  const idea = useWorkflowStore((s) => s.idea)
  const style = useWorkflowStore((s) => s.style)
  const setIdea = useWorkflowStore((s) => s.setIdea)
  const setStyle = useWorkflowStore((s) => s.setStyle)
  const setSession = useWorkflowStore((s) => s.setSession)
  const setSessionId = useWorkflowStore((s) => s.setSessionId)
  const setLoading = useWorkflowStore((s) => s.setLoading)
  const goToStep = useWorkflowStore((s) => s.goToStep)
  const setWizardStep = useWorkflowStore((s) => s.setWizardStep)
  const chatMessages = useWorkflowStore((s) => s.chatMessages)
  const agentSuggestions = useWorkflowStore((s) => s.agentSuggestions)
  const sendWsMessage = useWorkflowStore((s) => s.sendWsMessage)
  const story = useWorkflowStore((s) => s.story)
  const characters = useWorkflowStore((s) => s.characters)
  const scenes = useWorkflowStore((s) => s.scenes)

  // WebSocket connection — dispatches events into the store
  useSessionWebSocket(sessionId)

  // Start planning: create session, wait for WS, then start workflow
  const handleStartPlanning = useCallback(async () => {
    if (!idea) return
    setLoading(true)
    try {
      // Step 1: create session
      const createResp = await request<{ session_id: string }>(
        '/sessions',
        { method: 'POST', body: JSON.stringify({ idea, style: style || 'wuxia', user_requirement: '' }) },
      )
      const sid = createResp.session_id
      setSessionId(sid)
      setWizardStep(2)

      // Step 2: wait for WS connection (max 5s, then proceed anyway)
      await new Promise<void>((resolve) => {
        let elapsed = 0
        const maxWait = 5000
        const check = () => {
          const state = useWorkflowStore.getState()
          if (state.connectionState === 'connected' && state.sessionId === sid) {
            resolve()
          } else if (elapsed >= maxWait) {
            resolve() // proceed even if WS not ready
          } else {
            elapsed += 200
            setTimeout(check, 200)
          }
        }
        check()
      })

      // Step 3: start workflow via WebSocket (V3 gated — pre_confirm → execute → post_confirm)
      sendWsMessage({
        type: 'user:action',
        action: 'start_workflow',
        idea,
        style: style || 'wuxia',
        user_requirement: '',
        session_id: sid,
      })
      logger.userAction('start_workflow_via_ws', { sessionId: sid })
    } catch (err) {
      logger.error('Failed to start planning', err)
    } finally {
      setLoading(false)
    }
  }, [idea, style, setLoading, setSessionId, setWizardStep])

  // Session restore from URL param
  useEffect(() => {
    const sid = searchParams.get('session')
    if (!sid || sessionId) return
    getSession(sid).then((detail) => {
      if (!detail) return
      setSession(detail.session_id, detail.stage)
      const stageToStep: Record<string, number> = {
        created: 0, narrative_planning: 0, narrative_planned: 2,
        rendering: 4, rendered: 5, error: 0, cancelled: 0,
      }
      goToStep(stageToStep[detail.stage] ?? 0)
      setWizardStep(Math.max(2, (stageToStep[detail.stage] ?? 0) + 1) as WizardStep)
      logger.info('Session restored', { sessionId: sid, stage: detail.stage })
      useWorkflowStore.getState().sendWsMessage({
        type: 'user:message',
        message: '/resume',
        context: { current_step: detail.stage },
      })
    }).catch((err) => {
      logger.error('Failed to restore session', err)
    })
  }, [searchParams, sessionId, setSession, goToStep, setWizardStep])

  return (
    <div className="create-drama-page flex h-[calc(100vh-4rem)]">
      {/* Left: WorkArea */}
      <div className="flex-1 min-w-0 border-r">
        <WorkArea />
      </div>
      {/* Right: AgentChat */}
      <div className="w-96 flex-shrink-0">
        <AIChatPanel
          step={wizardStep}
          sessionId={sessionId}
          idea={idea}
          style={style}
          onIdeaExtracted={setIdea}
          onStyleExtracted={setStyle}
          onStartPlanning={handleStartPlanning}
          storyChars={story.length}
          characterCount={characters.length}
          sceneCount={scenes.length}
          totalShots={scenes.reduce((sum, s) => sum + (s.shot_count || 0), 0)}
          storeChatMessages={chatMessages}
          storeAgentSuggestions={agentSuggestions}
          onWSSendMessage={(text) => sendWsMessage({ type: 'user:message', message: text })}
        />
      </div>
    </div>
  )
}
