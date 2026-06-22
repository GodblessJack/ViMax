// ── ConfirmationGateBase ───────────────────────────────────────────────
// Shared confirmation UI component for both pre-exec and post-exec
// confirmations. Used by WorkArea (StepRunner/StepActions) and
// ChatPanel (ConfirmationGateInline).
//
// V3: replaces the V2 setInterval polling pattern with pure WS-driven
// confirmation flow. Supports bidirectional mutual exclusion between
// WorkArea and ChatPanel via lastConfirmationSource.

import { useMemo } from 'react'
import type { PreStepConfirmData, StepResult } from '@/stores/types'

export interface ConfirmationGateBaseProps {
  /** 'pre' = before step execution, 'post' = after step execution */
  mode: 'pre' | 'post'

  /** The step this confirmation belongs to */
  stepName: string
  stepIndex: number

  /** The confirmation message to display */
  message: string

  /** Quick action suggestions (e.g. ["确认", "重新生成", "需要修改"]) */
  suggestions: string[]

  /** Which panel rendered this gate */
  source: 'WorkArea' | 'ChatPanel'

  /** Pre-exec confirmation context (only meaningful when mode='pre') */
  preStepContext?: PreStepConfirmData | null

  /** Step execution result (only meaningful when mode='post') */
  stepResult?: StepResult | null

  /** Whether the confirmation is currently active/pending */
  isPending: boolean

  /** True when the OTHER panel is handling confirmation — disables controls */
  disabled: boolean

  /** Tracks which panel last issued a confirmation */
  lastConfirmationSource: 'WorkArea' | 'ChatPanel' | null

  // ── Callbacks ────────────────────────────────────────────────────

  /** User accepts (pre: run the step; post: advance to next step) */
  onConfirm: () => void

  /** User requests modification with optional feedback/changes */
  onModify: (feedback: string, changes?: Record<string, unknown>) => void

  /** User requests regeneration */
  onRegenerate: (feedback?: string) => void

  /** User dismisses/cancels the confirmation */
  onCancel: () => void
}

export function ConfirmationGateBase(props: ConfirmationGateBaseProps) {
  const {
    mode,
    stepName,
    stepIndex: _stepIndex,
    message,
    suggestions,
    preStepContext,
    stepResult,
    isPending,
    disabled,
    source: _source,
    lastConfirmationSource,
    onConfirm,
    onModify,
    onRegenerate,
    onCancel,
  } = props

  // Decide border/style based on mode
  const borderClass =
    mode === 'pre'
      ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950'
      : 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950'

  const headerClass =
    mode === 'pre'
      ? 'text-amber-800 dark:text-amber-200'
      : 'text-blue-800 dark:text-blue-200'

  const primaryBtnClass =
    mode === 'pre'
      ? 'bg-amber-600 hover:bg-amber-700 text-white'
      : 'bg-blue-600 hover:bg-blue-700 text-white'

  // Pre-exec context details
  const contextDetails = useMemo(() => {
    if (mode !== 'pre' || !preStepContext) return null
    const parts: string[] = []
    if (preStepContext.estimatedDuration)
      parts.push(`预估耗时: ${preStepContext.estimatedDuration}`)
    if (preStepContext.dependencies && preStepContext.dependencies.length > 0)
      parts.push(`依赖: ${preStepContext.dependencies.join(', ')}`)
    if (preStepContext.sideEffects && preStepContext.sideEffects.length > 0)
      parts.push(`副作用: ${preStepContext.sideEffects.join('; ')}`)
    return parts.length > 0 ? parts : null
  }, [mode, preStepContext])

  if (!isPending) return null

  const otherSource =
    lastConfirmationSource &&
    lastConfirmationSource !== (props.source as 'WorkArea' | 'ChatPanel')
      ? lastConfirmationSource
      : null

  return (
    <div
      className={`confirmation-gate rounded-xl border ${borderClass} p-4 space-y-3 animate-in fade-in slide-in-from-bottom-2`}
      role="alertdialog"
      aria-label={`${mode === 'pre' ? '预执行确认' : '执行后确认'} — ${stepName}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-lg" role="img" aria-hidden="true">
          {mode === 'pre' ? '⏳' : '✅'}
        </span>
        <p className={`font-semibold text-sm ${headerClass}`}>
          {mode === 'pre' ? '预执行确认' : '执行后确认'}
        </p>
      </div>

      {/* Message */}
      <p className="text-sm text-foreground/85 leading-relaxed">{message}</p>

      {/* Pre-exec context details */}
      {contextDetails && (
        <div className="text-xs space-y-0.5 text-muted-foreground bg-background/50 rounded-lg p-2.5">
          {contextDetails.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}

      {/* Post-exec result summary */}
      {mode === 'post' && stepResult?.summary && (
        <p className="text-xs text-muted-foreground bg-background/50 rounded-lg p-2.5">
          {stepResult.summary}
        </p>
      )}

      {/* Other panel indicator */}
      {otherSource && (
        <p className="text-xs text-muted-foreground italic">
          {otherSource === 'ChatPanel' ? '对话区' : '工作区'}正在处理确认...
        </p>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={onConfirm}
          disabled={disabled}
          className={`px-4 py-1.5 text-sm rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${primaryBtnClass}`}
        >
          {suggestions[0] || '确认'}
        </button>

        {suggestions.slice(1).map((label, i) => {
          if (label === '重新生成') {
            return (
              <button
                key={i}
                onClick={() => onRegenerate()}
                disabled={disabled}
                className="px-4 py-1.5 text-sm rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {label}
              </button>
            )
          }
          if (label === '需要修改') {
            return (
              <button
                key={i}
                onClick={() => onModify('', {})}
                disabled={disabled}
                className="px-4 py-1.5 text-sm rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {label}
              </button>
            )
          }
          return (
            <button
              key={i}
              onClick={() => onConfirm()}
              disabled={disabled}
              className="px-4 py-1.5 text-sm rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {label}
            </button>
          )
        })}

        {/* Cancel / dismiss */}
        <button
          onClick={onCancel}
          disabled={disabled}
          className="px-3 py-1.5 text-sm rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          忽略
        </button>
      </div>
    </div>
  )
}
