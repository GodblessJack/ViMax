import { cn } from '@/lib/utils'
import type { WizardStep } from '@/lib/types'

const STEPS: { step: WizardStep; label: string }[] = [
  { step: 1, label: '创意' },
  { step: 2, label: '规划' },
  { step: 3, label: '分镜' },
  { step: 4, label: '生成' },
  { step: 5, label: '导出' },
]

export default function StepIndicator({ current, onStepClick }: { current: WizardStep; onStepClick?: (s: WizardStep) => void }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {STEPS.map((s, i) => (
        <div key={s.step} className="flex items-center gap-1">
          <button
            onClick={() => onStepClick?.(s.step)}
            disabled={s.step > current}
            className={cn(
              'flex items-center justify-center h-9 w-9 rounded-full text-xs font-medium transition-colors',
              s.step < current && 'bg-primary text-primary-foreground',
              s.step === current && 'bg-primary text-primary-foreground ring-2 ring-primary/30',
              s.step > current && 'bg-muted text-muted-foreground cursor-not-allowed',
            )}
          >
            {s.step < current ? '✓' : s.step}
          </button>
          <span className={cn(
            'text-xs',
            s.step <= current ? 'text-foreground font-medium' : 'text-muted-foreground'
          )}>
            {s.label}
          </span>
          {i < STEPS.length - 1 && (
            <div className={cn(
              'h-px w-6 mx-1',
              s.step < current ? 'bg-primary' : 'bg-border'
            )} />
          )}
        </div>
      ))}
    </div>
  )
}
