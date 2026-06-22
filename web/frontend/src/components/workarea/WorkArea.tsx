import { Component } from 'react'
import { useWorkflowStore } from '@/stores/workflowStore'
import { StepNavigationBar } from './StepNavigationBar'
import { StepRunner } from './StepRunner'
import { StepActions } from './StepActions'
import { CreativeSettings } from './CreativeSettings'

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

/**
 * WorkArea — the primary result/confirmation panel.
 *
 * V3: Removed setInterval polling for /api/pipeline/confirm-status.
 * Confirmation UI is now driven purely by WebSocket events (step:need_confirm,
 * step:need_confirm_before) via the WorkflowStore. StepRunner renders
 * ConfirmationGate for pre-exec and post-exec confirmations. StepActions
 * delegates confirm/modify/regenerate to ConfirmationGate when active.
 */
export function WorkArea() {
  const sessionId = useWorkflowStore((s) => s.sessionId)
  const steps = useWorkflowStore((s) => s.steps)
  const currentStepIndex = useWorkflowStore((s) => s.currentStepIndex)
  const currentStep = steps[currentStepIndex]

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
