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

  // Poll session stage when no WS events are received (fallback)
  useEffect(() => {
    if (!sessionId) return
    let timer: ReturnType<typeof setInterval>
    let lastStage = sessionStage

    timer = setInterval(async () => {
      try {
        const resp = await fetch(`/api/sessions/${sessionId}`)
        const detail = await resp.json()
        if (!detail || detail.stage === lastStage) return
        lastStage = detail.stage

        // Load artifact content when stage advances
        if (detail.artifact_checklist) {
          const store = useWorkflowStore.getState()
          const baseUrl = `/api/files/${sessionId}/idea2video`

          try {
            if (detail.artifact_checklist.story) {
              const r = await fetch(`${baseUrl}/story.txt`)
              if (r.ok) store.setStory(await r.text())
            }
            if (detail.artifact_checklist.characters) {
              const r = await fetch(`${baseUrl}/characters.json`)
              if (r.ok) store.setCharacters(await r.json())
            }
            if (detail.artifact_checklist.script) {
              const r = await fetch(`${baseUrl}/script.json`)
              if (r.ok) store.setScenes(await r.json())
            }
            // Update runtime results with artifact content
            const completedUpTo = STAGE_TO_STEP[detail.stage] ?? 0
            const stepNames = ['story_generation','character_extraction','script_writing','storyboard_design','character_portraits','video_rendering'] as WorkflowStepName[]
            for (let i = 0; i < completedUpTo && i < stepNames.length; i++) {
              setRuntimeResult(stepNames[i], {
                summary: `${stepNames[i]} 已完成`,
                artifactPaths: [],
                previewData: i === 0 ? store.story : i === 1 ? store.characters : i === 2 ? store.scenes : null,
                editableFields: [],
              })
              setRuntimePhase(stepNames[i], 'done')
            }
          } catch { /* ignore fetch errors */ }
        }
        const stepNames: WorkflowStepName[] = [
          'story_generation', 'character_extraction', 'script_writing',
          'storyboard_design', 'character_portraits', 'video_rendering',
        ]

        // Mark all steps up to completedUpTo as completed
        for (let i = 0; i < stepNames.length; i++) {
          const status: StepStatus = i < completedUpTo ? 'completed' :
            i === completedUpTo ? 'running' : 'idle'
          setStepStatus(stepNames[i], status)
          if (i === completedUpTo) {
            setRuntimePhase(stepNames[i], 'running')
          }
          if (i < completedUpTo) {
            setRuntimeResult(stepNames[i], {
              summary: `步骤已完成`,
              artifactPaths: [],
              previewData: null,
              editableFields: [],
            })
            setRuntimePhase(stepNames[i], 'done')
          }
        }

        goToStep(Math.min(completedUpTo, stepNames.length - 1))
      } catch { /* ignore poll errors */ }
    }, 2000)

    return () => clearInterval(timer)
  }, [sessionId, sessionStage, goToStep, setStepStatus, setRuntimePhase, setRuntimeResult])

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
