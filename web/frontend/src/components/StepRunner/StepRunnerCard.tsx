// ── StepRunnerCard ─────────────────────────────────────────────────────
// Three-phase card component that reads step runtime state from the
// WorkflowStore. Not yet wired into CreateDramaPage — that is a separate task.
//
// Phases:
//   preparing   — spinner + "Initializing..."
//   running     — progress bar + streaming output log
//   done        — result summary (or error with retry action)
//
// Design follows the existing Tailwind class patterns from the project's
// wizard components (Step1IdeaInput, Step2PlanningReview, etc.).

import { useEffect, useRef } from 'react'
import { useWorkflowStore } from '@/stores/workflowStore'
import { cn } from '@/lib/utils'
import type { WorkflowStepName, StepRuntime } from '@/stores/types'

// ── Props ──────────────────────────────────────────────────────────────

export interface StepRunnerCardProps {
  /** The workflow step name (e.g. 'story_generation', 'video_rendering') */
  stepName: WorkflowStepName
  /** Human-readable label for the card header */
  label: string
  /** Optional CSS class override */
  className?: string
  /** Callback when user clicks retry after an error */
  onRetry?: (stepName: string) => void
}

// ── Helpers ────────────────────────────────────────────────────────────

const PHASE_ICONS: Record<string, string> = {
  preparing: String.fromCodePoint(0x27F3),
  running: String.fromCodePoint(0x23F3),
  done: String.fromCodePoint(0x2713),
}

const PHASE_COLORS: Record<string, string> = {
  preparing: 'text-muted-foreground',
  running: 'text-blue-500',
  done: 'text-green-600',
}

function autoScroll(el: HTMLPreElement | null) {
  if (el) el.scrollTop = el.scrollHeight
}

// ── Component ──────────────────────────────────────────────────────────

export function StepRunnerCard({ stepName, label, className, onRetry }: StepRunnerCardProps) {
  const runtime = useWorkflowStore((s) => s.runtime[stepName])
  const logRef = useRef<HTMLPreElement | null>(null)

  useEffect(() => {
    autoScroll(logRef.current)
  }, [runtime?.streamedOutput])

  // ── Guard: no runtime data yet ─────────────────────────────────────
  if (!runtime) {
    return (
      <div className={cn('rounded-xl border bg-card p-4 shadow-sm', className)}>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">-</span>
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          <span className="text-xs text-muted-foreground ml-auto">等待中</span>
        </div>
      </div>
    )
  }

  const phase = runtime.phase
  const error = runtime.error
  const hasResult = runtime.result !== null
  const percent = runtime.progressPercent
  const message = runtime.progressMessage
  const output = runtime.streamedOutput

  return (
    <div className={cn('rounded-xl border bg-card p-4 shadow-sm', className)}>
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-2">
        <span className={cn('text-base', PHASE_COLORS[phase])}>
          {PHASE_ICONS[phase] || '-'}
        </span>
        <span className="text-sm font-semibold">{label}</span>
        <span className={cn('text-xs ml-auto', PHASE_COLORS[phase])}>
          {phase === 'done' && !error ? '完成' : error ? '失败' : phase === 'preparing' ? '准备中' : '运行中'}
        </span>
      </div>

      {/* ── Progress bar (only during running) ────────────────────── */}
      {phase === 'running' && (
        <div className="w-full bg-muted rounded-full h-1.5 mb-2 overflow-hidden">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-500 ease-out"
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      )}

      {/* ── Progress message ──────────────────────────────────────── */}
      {message && (
        <p className="text-xs text-muted-foreground mb-2 truncate">{message}</p>
      )}

      {/* ── Streaming output log ──────────────────────────────────── */}
      {output && (
        <pre
          ref={logRef}
          className="text-[11px] font-mono leading-relaxed text-muted-foreground bg-muted/50 rounded-lg p-2 max-h-24 overflow-y-auto whitespace-pre-wrap break-all"
        >
          {output}
        </pre>
      )}

      {/* ── Result summary ────────────────────────────────────────── */}
      {hasResult && runtime.result && (
        <div className="mt-2 text-xs text-muted-foreground">
          <p>{runtime.result.summary}</p>
          {runtime.result.artifactPaths.length > 0 && (
            <p className="text-[10px] mt-1">
              生成文件: {runtime.result.artifactPaths.length} 个
            </p>
          )}
        </div>
      )}

      {/* ── Error state ───────────────────────────────────────────── */}
      {error && (
        <div className="mt-2 flex items-start gap-2">
          <div className="flex-1">
            <p className="text-xs text-red-600 font-medium">错误</p>
            <p className="text-[11px] text-red-500 mt-0.5">{error}</p>
          </div>
          {onRetry && (
            <button
              onClick={() => onRetry(stepName)}
              className="shrink-0 rounded-lg bg-red-50 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors"
            >
              重试
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── StepRunnerPanel (aggregate view of all steps) ──────────────────────
// Renders a vertical list of StepRunnerCard for every step in the workflow.

export interface StepRunnerPanelProps {
  /** Filter to only show steps with these names (optional) */
  filterSteps?: WorkflowStepName[]
  /** Callback when user clicks retry */
  onRetry?: (stepName: string) => void
  className?: string
}

export function StepRunnerPanel({ filterSteps, onRetry, className }: StepRunnerPanelProps) {
  const steps = useWorkflowStore((s) => s.steps)

  const visible = filterSteps
    ? steps.filter((s) => filterSteps.includes(s.name))
    : steps

  return (
    <div className={cn('space-y-2', className)}>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        工作流步骤
      </h3>
      {visible.map((step) => (
        <StepRunnerCard
          key={step.name}
          stepName={step.name}
          label={step.label}
          onRetry={onRetry}
        />
      ))}
    </div>
  )
}

// ── ActiveStepRunner (show only the currently active step) ────────────

export interface ActiveStepRunnerProps {
  onRetry?: (stepName: string) => void
  className?: string
}

export function ActiveStepRunner({ onRetry, className }: ActiveStepRunnerProps) {
  const activeStepName = useWorkflowStore((s) => s.activeStepName)
  const steps = useWorkflowStore((s) => s.steps)

  if (!activeStepName) return null

  const stepDef = steps.find((s) => s.name === activeStepName)
  if (!stepDef) return null

  return (
    <StepRunnerCard
      stepName={activeStepName}
      label={stepDef.label}
      onRetry={onRetry}
      className={className}
    />
  )
}
