import { useState, useMemo } from 'react'
import type { PreStepConfirmData, StepResult } from '@/stores/types'

// ── Props Interface ───────────────────────────────────────────────────

export interface ConfirmationGateProps {
  /** Confirmation phase: before=pre-execution, after=post-execution */
  phase: 'before' | 'after'

  /** Step name (e.g. "story_generation") */
  stepName: string

  /** Step index (0-based) */
  stepIndex: number

  /** Confirmation prompt message */
  message: string

  /** Quick suggestion options */
  suggestions: string[]

  /** Which panel originated this confirmation */
  source: 'WorkArea' | 'ChatPanel'

  /** Pre-execution context (only valid when phase='before') */
  preStepContext?: PreStepConfirmData | null

  /** Step execution result (only valid when phase='after') */
  stepResult?: StepResult | null

  /** Whether confirmation is currently pending */
  isPending: boolean

  /** Whether this gate is disabled (other panel is handling confirmation) */
  disabled: boolean

  /** Who last operated on the confirmation */
  lastConfirmationSource: 'WorkArea' | 'ChatPanel' | null

  /** Which side has confirmed (user or agent) */
  confirmedBy: 'user' | 'agent' | null

  /** User confirms and proceeds */
  onConfirm: () => void

  /** User rejects (pre-exec) or modifies (post-exec) */
  onModify: (feedback: string, changes?: Record<string, unknown>) => void

  /** User requests regeneration */
  onRegenerate: (feedback?: string) => void

  /** User wants to discuss in chat */
  onDiscuss: () => void

  /** User cancels / dismisses confirmation */
  onCancel: () => void
}

// ── Step Name Labels ──────────────────────────────────────────────────

const STEP_LABELS: Record<string, string> = {
  story_generation: '故事构思',
  character_extraction: '角色提取',
  script_writing: '剧本编写',
  storyboard_design: '分镜设计',
  character_portraits: '角色肖像',
  video_rendering: '视频渲染',
}

function stepLabel(name: string): string {
  return STEP_LABELS[name] ?? name
}

// ── Component ─────────────────────────────────────────────────────────

export default function ConfirmationGate(props: ConfirmationGateProps) {
  const {
    phase,
    stepName,
    stepIndex,
    message,
    suggestions,
    source,
    preStepContext,
    stepResult,
    isPending,
    disabled,
    lastConfirmationSource,
    confirmedBy,
    onConfirm,
    onModify,
    onRegenerate,
    onDiscuss,
    onCancel,
  } = props

  const [feedback, setFeedback] = useState('')
  const [showFeedbackInput, setShowFeedbackInput] = useState(false)

  const label = stepLabel(stepName)

  // ── Disabled overlay ──────────────────────────────────────────────
  if (disabled) {
    const otherPanel =
      lastConfirmationSource === 'ChatPanel' ? '对话区' : '工作区'
    return (
      <div className="confirmation-gate flex flex-col items-center justify-center gap-3 p-6 border rounded-lg bg-muted/30 text-muted-foreground">
        <span className="text-lg" role="img" aria-label="等待">
          ⏳
        </span>
        <p className="text-sm font-medium">
          {otherPanel}正在确认中...
        </p>
        <p className="text-xs">
          请等待{otherPanel}完成确认操作后再继续
        </p>
      </div>
    )
  }

  // ── Not pending (idle state) ──────────────────────────────────────
  if (!isPending) {
    return null
  }

  // ── Inline feedback form ──────────────────────────────────────────
  const handleModifySubmit = () => {
    if (phase === 'before') {
      onModify(feedback || '用户拒绝执行')
    } else {
      onModify(feedback)
    }
    setFeedback('')
    setShowFeedbackInput(false)
  }

  // ── confirmedBy badge ─────────────────────────────────────────────
  const ConfirmedByBadge = () => {
    if (!confirmedBy) return null
    const isAgent = confirmedBy === 'agent'
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
          isAgent
            ? 'bg-blue-100 text-blue-700 border border-blue-200'
            : 'bg-green-100 text-green-700 border border-green-200'
        }`}
      >
        <span role="img" aria-label={confirmedBy}>
          {isAgent ? '🤖' : '👤'}
        </span>
        {isAgent ? 'Agent 确认' : '用户确认'}
      </span>
    )
  }

  // ── Source badge ──────────────────────────────────────────────────
  const SourceBadge = () => (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border">
      {source === 'WorkArea' ? '📋 工作区' : '💬 对话区'}
    </span>
  )

  // ── Pre-Confirm Mode ─────────────────────────────────────────────
  if (phase === 'before') {
    const params = preStepContext?.params
    const estimatedDuration = preStepContext?.estimatedDuration
    const sideEffects = preStepContext?.sideEffects
    const dependencies = preStepContext?.dependencies
    const requestedBy = preStepContext?.requestedBy

    return (
      <div className="confirmation-gate flex flex-col gap-4 p-5 border-2 border-amber-200 bg-amber-50/60 rounded-lg">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-base text-foreground">
                步骤 {stepIndex + 1} · {label}
              </h3>
              <SourceBadge />
            </div>
            <p className="text-sm text-muted-foreground">{message}</p>
          </div>
          <ConfirmedByBadge />
        </div>

        {/* Context: parameters summary */}
        {params && Object.keys(params).length > 0 && (
          <div className="space-y-2 bg-white/70 rounded-lg p-3 border border-amber-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              执行参数
            </p>
            <ul className="space-y-1">
              {Object.entries(params).map(([key, value]) => (
                <li key={key} className="text-sm flex gap-2">
                  <span className="font-medium text-muted-foreground shrink-0">
                    {key}:
                  </span>
                  <span className="text-foreground break-all">
                    {typeof value === 'string'
                      ? value.length > 200
                        ? value.slice(0, 200) + '...'
                        : value
                      : JSON.stringify(value)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Context: estimated duration & dependencies */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          {estimatedDuration && (
            <div className="bg-white/70 rounded-lg p-2 border border-amber-100">
              <span className="font-medium text-muted-foreground">
                预估耗时:{' '}
              </span>
              <span>{estimatedDuration}</span>
            </div>
          )}
          {requestedBy && (
            <div className="bg-white/70 rounded-lg p-2 border border-amber-100">
              <span className="font-medium text-muted-foreground">
                发起方:{' '}
              </span>
              <span>{requestedBy === 'agent' ? '🤖 Agent' : '👤 用户'}</span>
            </div>
          )}
        </div>

        {/* Dependencies */}
        {dependencies && dependencies.length > 0 && (
          <div className="space-y-1 bg-white/70 rounded-lg p-3 border border-amber-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              前置依赖
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-0.5">
              {dependencies.map((dep, i) => (
                <li key={i}>{stepLabel(dep)}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Side effects */}
        {sideEffects && sideEffects.length > 0 && (
          <div className="space-y-1 bg-white/70 rounded-lg p-3 border border-amber-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              副作用
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-0.5">
              {sideEffects.map((fx, i) => (
                <li key={i}>{fx}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Action buttons */}
        {!showFeedbackInput ? (
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <button
              onClick={onConfirm}
              className="px-6 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
            >
              确认开始
            </button>
            <button
              onClick={() => setShowFeedbackInput(true)}
              className="px-4 py-2 text-sm rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
            >
              拒绝
            </button>
            <button
              onClick={onDiscuss}
              className="px-4 py-2 text-sm rounded-lg border hover:bg-muted transition-colors"
            >
              在对话区讨论
            </button>
          </div>
        ) : (
          <div className="space-y-2 bg-white/70 rounded-lg p-3 border border-amber-100">
            <p className="text-sm font-medium">请说明拒绝原因或修改建议</p>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="例如：把风格改成悬疑..."
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
              rows={3}
              autoFocus
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleModifySubmit}
                className="px-4 py-1.5 text-sm rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                确认拒绝
              </button>
              <button
                onClick={() => {
                  setShowFeedbackInput(false)
                  setFeedback('')
                }}
                className="px-4 py-1.5 text-sm rounded-lg border hover:bg-muted transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* Suggestions chips */}
        {suggestions.length > 0 && !showFeedbackInput && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">快速回复:</span>
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => setFeedback(s)}
                className="px-2.5 py-1 text-xs rounded-full bg-white border hover:bg-muted transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Post-Confirm Mode ────────────────────────────────────────────
  const resultSummary = stepResult?.summary
  const artifactPaths = stepResult?.artifactPaths ?? []

  return (
    <div className="confirmation-gate flex flex-col gap-4 p-5 border-2 border-green-200 bg-green-50/60 rounded-lg">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-base text-foreground">
              步骤 {stepIndex + 1} · {label} — 已完成
            </h3>
            <SourceBadge />
          </div>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
        <ConfirmedByBadge />
      </div>

      {/* Result preview */}
      {(resultSummary || artifactPaths.length > 0) && (
        <div className="space-y-3 bg-white/70 rounded-lg p-3 border border-green-100">
          {resultSummary && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                结果摘要
              </p>
              <p className="text-sm leading-relaxed">{resultSummary}</p>
            </div>
          )}
          {artifactPaths.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                产物文件 ({artifactPaths.length})
              </p>
              <ul className="list-disc list-inside text-sm text-muted-foreground space-y-0.5">
                {artifactPaths.map((p, i) => (
                  <li key={i} className="font-mono text-xs break-all">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      {!showFeedbackInput ? (
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <button
            onClick={onConfirm}
            className="px-6 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
          >
            确认
          </button>
          <button
            onClick={() => onRegenerate()}
            className="px-4 py-2 text-sm rounded-lg border hover:bg-muted transition-colors"
          >
            重新生成
          </button>
          <button
            onClick={onDiscuss}
            className="px-4 py-2 text-sm rounded-lg border hover:bg-muted transition-colors"
          >
            在对话区讨论
          </button>
        </div>
      ) : (
        <div className="space-y-2 bg-white/70 rounded-lg p-3 border border-green-100">
          <p className="text-sm font-medium">请说明修改要求</p>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="例如：把角色名字改成..."
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
            rows={3}
            autoFocus
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleModifySubmit}
              className="px-4 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              提交修改
            </button>
            <button
              onClick={() => {
                setShowFeedbackInput(false)
                setFeedback('')
              }}
              className="px-4 py-1.5 text-sm rounded-lg border hover:bg-muted transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Suggestions chips */}
      {suggestions.length > 0 && !showFeedbackInput && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">快速回复:</span>
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => {
                if (s === '确认') onConfirm()
                else if (s === '重新生成') onRegenerate()
                else if (s === '需要修改') setShowFeedbackInput(true)
                else setFeedback(s)
              }}
              className="px-2.5 py-1 text-xs rounded-full bg-white border hover:bg-muted transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
