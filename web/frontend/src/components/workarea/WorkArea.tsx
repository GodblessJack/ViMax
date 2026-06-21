import { Component, useEffect } from 'react'
import { useWorkflowStore } from '@/stores/workflowStore'
import { StepNavigationBar } from './StepNavigationBar'
import { StepRunner } from './StepRunner'
import { StepActions } from './StepActions'
import { CreativeSettings } from './CreativeSettings'
import type { WorkflowStepName, StepStatus } from '@/stores/types'

const STAGE_TO_STEP: Record<string, number> = {
  created: 0, narrative_planning: 0, narrative_planned: 3,
  rendering: 4, rendered: 5, error: 0, cancelled: 0,
}

class PanelErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  render() {
    if (this.state.hasError) {
      return <div className="p-4 text-destructive">结果面板加载失败，请刷新页面重试</div>
    }
    return this.props.children
  }
}

export function WorkArea() {
  const sessionId = useWorkflowStore((s) => s.sessionId)
  const sessionStage = useWorkflowStore((s) => s.sessionStage)
  const steps = useWorkflowStore((s) => s.steps)
  const currentStepIndex = useWorkflowStore((s) => s.currentStepIndex)
  const goToStep = useWorkflowStore((s) => s.goToStep)
  const setStepStatus = useWorkflowStore((s) => s.setStepStatus)
  const setRuntimePhase = useWorkflowStore((s) => s.setRuntimePhase)
  const setRuntimeResult = useWorkflowStore((s) => s.setRuntimeResult)
  const currentStep = steps[currentStepIndex]

  // Poll for confirmation status and load artifacts.
  // Uses the REST confirmation-status endpoint as the source of truth for
  // which step is currently awaiting user confirmation.  Does NOT drive
  // step progression from session stage — that is the WS event handler's job.
  useEffect(() => {
    if (!sessionId) return
    let timer: ReturnType<typeof setInterval>
    let lastWsActivity = Date.now()

    const unsub = useWorkflowStore.subscribe((state, prev) => {
      if (state.runtime !== prev.runtime) lastWsActivity = Date.now()
    })

    timer = setInterval(async () => {
      try {
        const store = useWorkflowStore.getState()

        // If WS is actively driving state, don't interfere
        if (Date.now() - lastWsActivity < 8000) return

        // Poll confirmation status
        const csResp = await fetch(`/api/pipeline/confirm-status/${sessionId}`)
        if (!csResp.ok) return
        const cs = await csResp.json() as { waiting: boolean; step: string | null }

        // If backend is waiting for confirmation on a step, ensure frontend
        // shows that step as done with confirm button, and don't advance.
        if (cs.waiting && cs.step) {
          const store = useWorkflowStore.getState()
          const stepIdx = store.steps.find(s => s.name === cs.step)?.index
          if (stepIdx !== undefined) {
            // Only set state if this step doesn't already have WS-driven data
            const existing = store.runtime[cs.step]
            if (!existing || existing.phase !== 'done') {
              // Load artifacts if needed
              await _loadArtifacts(sessionId, store)
              // Mark previous steps as completed and this step as done+waiting
              const stepNames: WorkflowStepName[] = [
                'story_generation', 'character_extraction', 'script_writing',
                'storyboard_design', 'character_portraits', 'video_rendering',
              ]
              for (let i = 0; i < stepNames.length; i++) {
                const sn = stepNames[i]
                const ext = store.runtime[sn]
                if (ext?.phase === 'done' || ext?.phase === 'running') continue
                if (i < stepIdx) {
                  setRuntimeResult(sn, {
                    summary: `${sn} 已完成`,
                    artifactPaths: [],
                    previewData:
                      i === 0 ? store.story :
                      i === 1 ? store.characters :
                      i === 2 ? store.scenes : null,
                    editableFields: [],
                  })
                  setRuntimePhase(sn, 'done')
                  setStepStatus(sn, 'completed')
                } else if (i === stepIdx) {
                  setRuntimePhase(sn, 'done')
                  setStepStatus(sn, 'completed')
                  // Set pending confirmation so StepActions shows confirm button
                  if (!store.pendingConfirmation) {
                    store.setPendingConfirmation({
                      stepIndex: i,
                      stepName: sn,
                      message: `${sn} 已完成，请审阅确认`,
                      suggestions: ['确认', '重新生成', '需要修改'],
                      timestamp: Date.now(),
                    })
                  }
                }
              }
              goToStep(stepIdx)
            }
          }
        }

        // Always try loading artifacts regardless of confirmation state
        await _loadArtifacts(sessionId, useWorkflowStore.getState())
      } catch { /* ignore poll errors */ }
    }, 2000)

    return () => {
      clearInterval(timer)
      unsub()
    }

    async function _loadArtifacts(sessionId: string, store: ReturnType<typeof useWorkflowStore.getState>) {
      const baseUrl = `/api/files/${sessionId}/idea2video`
      try {
        if (!store.story) {
          const r = await fetch(`${baseUrl}/story.txt`)
          if (r.ok) store.setStory(await r.text())
        }
        if (store.characters.length === 0) {
          const r = await fetch(`${baseUrl}/characters.json`)
          if (r.ok) store.setCharacters(await r.json())
        }
        if (store.scenes.length === 0) {
          const r = await fetch(`${baseUrl}/script.json`)
          if (r.ok) store.setScenes(await r.json())
        }
        if (store.storyboardScenes.length === 0) {
          const r = await fetch(`${baseUrl}/scene_0/storyboard.json`)
          if (r.ok) {
            const data = await r.json()
            if (Array.isArray(data)) {
              const scenes = [{
                index: 0,
                title: '场景 1',
                shots: data.map((s: any, i: number) => ({
                  idx: i + 1,
                  visual_desc: s.visual_description?.slice(0, 120) || '',
                  angle: s.camera_angle || s.angle || '中景',
                })),
              }]
              store.setStoryboardScenes(scenes)
            }
          }
        }
      } catch { /* ignore fetch errors */ }
    }
  }, [sessionId, goToStep, setStepStatus, setRuntimePhase, setRuntimeResult])

  if (!sessionId) {
    return <CreativeSettings />
  }

  return (
    <div className="work-area flex flex-col h-full">
      <StepNavigationBar />
      {currentStep && (
        <PanelErrorBoundary>
          <StepRunner step={currentStep} />
        </PanelErrorBoundary>
      )}
      {currentStep && <StepActions step={currentStep} />}
    </div>
  )
}
