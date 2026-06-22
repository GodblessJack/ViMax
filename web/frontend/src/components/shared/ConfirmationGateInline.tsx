// ── ConfirmationGateInline ──────────────────────────────────────────────
// ChatPanel-specific inline confirmation component for pre-execution
// confirmation gates. Renders as a chat message bubble with action
// buttons (confirm / modify-before-execute / cancel).
//
// V3: Extracted from AIChatPanel to match the ConfirmationGateBase pattern
// used by WorkArea. Enables bidirectional mutual exclusion between panels
// via lastConfirmationSource.

import { useState } from 'react'
import { AlertTriangle, Play, PenLine } from 'lucide-react'
import type { PreStepConfirmData } from '@/stores/types'

export interface ConfirmationGateInlineProps {
  /** Pre-execution confirmation data from WorkflowStore */
  preStepConfirmData: PreStepConfirmData

  /** True when WorkArea is actively handling the confirmation */
  workAreaConfirming: boolean

  // ── Callbacks ──────────────────────────────────────────────────────

  /** User accepts — proceed with step execution */
  onConfirm: () => void

  /** User wants to modify params before execution (reply + optional changes) */
  onModify: (reply: string, changes?: Record<string, unknown>) => void

  /** User dismisses/cancels the pre-confirmation */
  onReject: () => void
}

export default function ConfirmationGateInline({
  preStepConfirmData,
  workAreaConfirming,
  onConfirm,
  onModify,
  onReject,
}: ConfirmationGateInlineProps) {
  const [showInput, setShowInput] = useState(false)
  const [modifyText, setModifyText] = useState('')

  const handleSubmitModify = () => {
    const feedback = modifyText.trim() || '用户要求修改后执行'
    onModify(feedback)
    setShowInput(false)
    setModifyText('')
  }

  const handleCancelModify = () => {
    setShowInput(false)
    setModifyText('')
  }

  return (
    <div className="confirmation-gate-inline rounded-xl border border-amber-200 bg-amber-50/80 p-4 space-y-3">
      {/* Header: step info */}
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-amber-800">
            确认执行: {preStepConfirmData.stepName}
          </p>
          {preStepConfirmData.estimatedDuration && (
            <p className="text-xs text-amber-700 mt-1">
              预计耗时: {preStepConfirmData.estimatedDuration}
            </p>
          )}
          {preStepConfirmData.sideEffects && preStepConfirmData.sideEffects.length > 0 && (
            <ul className="text-xs text-amber-600 mt-1 list-disc list-inside">
              {preStepConfirmData.sideEffects.map((se, i) => (
                <li key={i}>{se}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={onConfirm}
          disabled={workAreaConfirming}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
        >
          <Play className="h-3 w-3" />
          确认执行
        </button>
        <button
          onClick={() => { setShowInput(true); setModifyText('') }}
          disabled={workAreaConfirming}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200 transition-colors disabled:opacity-40"
        >
          <PenLine className="h-3 w-3" />
          修改后执行
        </button>
        <button
          onClick={onReject}
          disabled={workAreaConfirming}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border hover:bg-muted transition-colors disabled:opacity-40"
        >
          取消
        </button>
        {workAreaConfirming && (
          <span className="text-[10px] text-muted-foreground self-center">
            WorkArea 正在确认中...
          </span>
        )}
      </div>

      {/* Modify-before-execute input (conditional) */}
      {showInput && (
        <div className="space-y-2">
          <textarea
            value={modifyText}
            onChange={(e) => setModifyText(e.target.value)}
            placeholder="输入修改意见（如：调整风格、修改角色设定...）"
            className="w-full text-xs border border-amber-300 rounded-lg p-2 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none"
            rows={2}
          />
          <div className="flex gap-2">
            <button
              onClick={handleSubmitModify}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              提交修改
            </button>
            <button
              onClick={handleCancelModify}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border hover:bg-muted transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
