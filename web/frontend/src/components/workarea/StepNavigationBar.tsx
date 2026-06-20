import { useWorkflowStore } from '@/stores/workflowStore'
import { CheckCircle2, Circle, AlertCircle, Clock } from 'lucide-react'

const STATUS_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  completed: CheckCircle2,
  error: AlertCircle,
  running: Clock,
  idle: Circle,
  preparing: Clock,
  skipped: Circle,
}

export function StepNavigationBar() {
  const steps = useWorkflowStore((s) => s.steps)
  const currentStepIndex = useWorkflowStore((s) => s.currentStepIndex)
  const confirmedSteps = useWorkflowStore((s) => s.confirmedSteps)
  const goToStep = useWorkflowStore((s) => s.goToStep)
  const runtime = useWorkflowStore((s) => s.runtime)

  return (
    <div className="step-navigation-bar flex items-center gap-1 px-4 py-3 overflow-x-auto border-b">
      {steps.map((step, idx) => {
        const isCurrent = idx === currentStepIndex
        const isConfirmed = confirmedSteps.has(idx)
        const isCompleted = step.status === 'completed'
        const isClickable = isConfirmed || isCompleted || idx <= currentStepIndex
        const rt = runtime[step.name]
        const status = rt?.phase === 'done' ? 'completed'
          : rt?.phase === 'running' ? 'running'
          : step.status
        const Icon = STATUS_ICON[status] || Circle

        return (
          <button
            key={step.name}
            onClick={() => isClickable && goToStep(idx)}
            disabled={!isClickable}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap
              transition-colors
              ${isCurrent ? 'bg-primary text-primary-foreground font-medium' : ''}
              ${isClickable && !isCurrent ? 'hover:bg-muted cursor-pointer' : ''}
              ${!isClickable ? 'opacity-50 cursor-not-allowed' : ''}
            `}
            title={step.label}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{idx + 1}. {step.label}</span>
          </button>
        )
      })}
    </div>
  )
}
