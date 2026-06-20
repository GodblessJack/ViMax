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
