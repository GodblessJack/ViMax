import type { WorkflowStep } from '@/stores/types'
import { useWorkflowStore } from '@/stores/workflowStore'

/**
 * StepActions — bottom action bar for the current workflow step.
 *
 * V3: When ConfirmationGate is active in StepRunner (pre or post mode),
 * confirm/modify/regenerate buttons are delegated to the gate.
 * StepActions only shows auxiliary buttons: nav, discuss, error actions.
 */
export function StepActions({ step }: { step: WorkflowStep }) {
  const currentStepIndex = useWorkflowStore((s) => s.currentStepIndex)
  const confirmedSteps = useWorkflowStore((s) => s.confirmedSteps)
  const runtime = useWorkflowStore((s) => s.runtime[step.name])
  const prevStep = useWorkflowStore((s) => s.prevStep)
  const confirmStep = useWorkflowStore((s) => s.confirmStep)
  const requestRegenerate = useWorkflowStore((s) => s.requestRegenerate)
  const sendWsMessage = useWorkflowStore((s) => s.sendWsMessage)
  const sessionId = useWorkflowStore((s) => s.sessionId)
  const connectionState = useWorkflowStore((s) => s.connectionState)

  // ── V3: Check if ConfirmationGate is handling confirm/modify/regenerate ──
  const preStepConfirmData = useWorkflowStore((s) => s.preStepConfirmData)
  const pendingConfirmations = useWorkflowStore((s) => s.pendingConfirmations)

  const hasPreGate =
    runtime?.phase === 'preparing' &&
    preStepConfirmData !== null &&
    preStepConfirmData.stepName === step.name

  const hasPostGate =
    runtime?.phase === 'done' &&
    pendingConfirmations.some((pc) => pc.stepName === step.name) &&
    !runtime?.error

  // When ConfirmationGate handles confirmation, StepActions delegates to it
  const gateActive = hasPreGate || hasPostGate

  const isDone = runtime?.phase === 'done'
  const isError = !!runtime?.error
  const isConfirmed = confirmedSteps.has(step.index)
  const isLastStep = step.index === 5

  if (!isDone) return null

  const doConfirm = async () => {
    confirmStep(step.index)
    // Try WS first; fall back to REST
    if (connectionState === 'connected') {
      sendWsMessage({ type: 'user:confirm', step: step.name })
    } else {
      try {
        await fetch(`/api/pipeline/confirm/${sessionId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ step: step.name }),
        })
      } catch { /* ignore */ }
    }
  }

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

      {/* ── V3: Delegated to ConfirmationGate when gate is active ── */}
      {!gateActive && (
        <>
          {/* Confirm */}
          {step.requiresConfirmation && !isConfirmed && !isError && (
            <button
              onClick={doConfirm}
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
        </>
      )}

      {/* ── V3: Gate-active indicator ── */}
      {gateActive && (
        <p className="text-xs text-muted-foreground italic">
          请在上方确认区完成操作
        </p>
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
            message: `我想讨论一下 ${step.label}...`,
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
