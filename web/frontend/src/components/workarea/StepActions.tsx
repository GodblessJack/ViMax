import type { WorkflowStep } from '@/stores/types'
import { useWorkflowStore } from '@/stores/workflowStore'

export function StepActions({ step }: { step: WorkflowStep }) {
  const currentStepIndex = useWorkflowStore((s) => s.currentStepIndex)
  const confirmedSteps = useWorkflowStore((s) => s.confirmedSteps)
  const runtime = useWorkflowStore((s) => s.runtime[step.name])
  const prevStep = useWorkflowStore((s) => s.prevStep)
  const confirmStep = useWorkflowStore((s) => s.confirmStep)
  const requestRegenerate = useWorkflowStore((s) => s.requestRegenerate)
  const sendWsMessage = useWorkflowStore((s) => s.sendWsMessage)

  const isDone = runtime?.phase === 'done'
  const isError = !!runtime?.error
  const isConfirmed = confirmedSteps.has(step.index)
  const isLastStep = step.index === 5

  if (!isDone) return null

  return (
    <div className="step-actions flex items-center justify-center gap-3 p-4 border-t">
      {/* Previous step */}
      {(currentStepIndex > 0 || isError) && (
        <button
          onClick={prevStep}
          className="px-4 py-2 text-sm rounded-lg border hover:bg-muted transition-colors"
        >
          ← 上一步
        </button>
      )}

      {/* Confirm */}
      {step.requiresConfirmation && !isConfirmed && !isError && (
        <button
          onClick={() => {
            confirmStep(step.index)
            sendWsMessage({ type: 'user:confirm', step: step.name })
          }}
          className="px-6 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
        >
          确认，进入下一步
        </button>
      )}

      {/* Regenerate */}
      {!isError && (
        <button
          onClick={() => {
            requestRegenerate(step.index)
          }}
          className="px-4 py-2 text-sm rounded-lg border hover:bg-muted transition-colors"
        >
          重新生成
        </button>
      )}

      {/* Error retry */}
      {isError && (
        <button
          onClick={() => {
            requestRegenerate(step.index)
          }}
          className="px-4 py-2 text-sm rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
        >
          重试
        </button>
      )}

      {/* Error skip */}
      {isError && step.canSkip && (
        <button
          onClick={() => {
            sendWsMessage({
              type: 'user:action',
              action: 'skip_step',
              payload: { step: step.name },
            })
          }}
          className="px-4 py-2 text-sm rounded-lg border hover:bg-muted transition-colors"
        >
          跳过此步骤
        </button>
      )}

      {/* Discuss */}
      <button
        onClick={() => {
          sendWsMessage({
            type: 'user:message',
            text: `我想讨论一下 ${step.label}...`,
            context: { current_step: step.name },
          })
        }}
        className="px-4 py-2 text-sm rounded-lg border hover:bg-muted transition-colors"
      >
        在对话区讨论
      </button>
    </div>
  )
}
