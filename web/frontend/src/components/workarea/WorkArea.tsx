import { useWorkflowStore } from '@/stores/workflowStore'
import { StepNavigationBar } from './StepNavigationBar'
import { StepRunner } from './StepRunner'
import { StepActions } from './StepActions'

export function WorkArea() {
  const sessionId = useWorkflowStore((s) => s.sessionId)
  const steps = useWorkflowStore((s) => s.steps)
  const currentStepIndex = useWorkflowStore((s) => s.currentStepIndex)
  const currentStep = steps[currentStepIndex]

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        创建会话后开始创作流程
      </div>
    )
  }

  return (
    <div className="work-area flex flex-col h-full">
      <StepNavigationBar />
      {currentStep && <StepRunner step={currentStep} />}
      {currentStep && <StepActions step={currentStep} />}
    </div>
  )
}
