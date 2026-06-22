import { Suspense, useMemo } from 'react'
import type { WorkflowStep, WorkflowStepName } from '@/stores/types'
import { useWorkflowStore } from '@/stores/workflowStore'
import { STEP_RESULT_COMPONENTS } from './panels/index'
import { ConfirmationGateBase } from '@/components/shared/ConfirmationGateBase'

/**
 * Resolve the best available data for a step's result panel.
 * Prefers server-side previewData; falls back to dedicated store fields.
 */
function useStepResultData(
  stepName: WorkflowStepName,
  previewData: unknown,
): unknown {
  const story = useWorkflowStore((s) => s.story)
  const characters = useWorkflowStore((s) => s.characters)
  const scenes = useWorkflowStore((s) => s.scenes)
  const storyboardScenes = useWorkflowStore((s) => s.storyboardScenes)
  const artifacts = useWorkflowStore((s) => s.artifacts)
  const finalVideoUrl = useWorkflowStore((s) => s.finalVideoUrl)

  // Store data (full content) is authoritative for content-heavy steps.
  // PreviewData from WS is metadata-only — use it for initial display only
  // when store data hasn't arrived yet.
  const storeFallback = _storeData(stepName, { story, characters, scenes, storyboardScenes, artifacts, finalVideoUrl })

  // Prefer full store data over preview metadata
  if (_isContentful(storeFallback)) return storeFallback

  // Unwrap preview object for initial display
  const resolved = _resolvePreview(stepName, previewData)
  if (_isContentful(resolved)) return resolved

  return storeFallback ?? resolved ?? undefined
}

function _storeData(stepName: WorkflowStepName, s: {
  story: string; characters: unknown[]; scenes: unknown[]
  storyboardScenes: unknown[]; artifacts: Record<string, unknown>
  finalVideoUrl: string | null
}): unknown {
  switch (stepName) {
    case 'story_generation': return s.story || undefined
    case 'character_extraction': return s.characters.length > 0 ? s.characters : undefined
    case 'script_writing': return s.scenes.length > 0 ? s.scenes : undefined
    case 'storyboard_design': return s.storyboardScenes.length > 0 ? s.storyboardScenes : undefined
    case 'character_portraits': return s.artifacts['portraits'] ?? undefined
    case 'video_rendering':
      return s.finalVideoUrl ? { finalVideoUrl: s.finalVideoUrl }
        : s.artifacts['final_video'] ?? undefined
    default: return undefined
  }
}

function _isContentful(v: unknown): boolean {
  if (v === undefined || v === null) return false
  if (typeof v === 'string') return v.length > 0
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}

/**
 * Unwrap backend preview objects into data the result panels expect.
 * Backend sends metadata envelopes like {storyPreview, totalChars, paragraphCount}
 * or {characterNames, count}. Extract the core data from these envelopes.
 */
function _resolvePreview(stepName: WorkflowStepName, previewData: unknown): unknown {
  if (previewData === undefined || previewData === null) return undefined
  if (typeof previewData !== 'object' || Array.isArray(previewData)) {
    return previewData
  }

  const obj = previewData as Record<string, unknown>

  switch (stepName) {
    case 'story_generation':
      if (typeof obj.storyPreview === 'string' && obj.storyPreview.length > 0) {
        return obj.storyPreview
      }
      return undefined

    case 'character_extraction':
      // Backend sends {characterNames: [...], count: N}
      if (Array.isArray(obj.characterNames)) return obj.characterNames
      if (Array.isArray(obj.characters)) return obj.characters
      return undefined

    case 'script_writing':
      if (Array.isArray(obj.scenes)) return obj.scenes
      if (typeof obj.script_preview === 'string') return obj.script_preview
      return undefined

    case 'storyboard_design':
      if (Array.isArray(obj.storyboards)) return obj.storyboards
      if (typeof obj.sceneCount === 'number') return obj // metadata, panel handles it
      return undefined

    case 'character_portraits':
      if (Array.isArray(obj.portraits)) return obj.portraits
      return undefined

    case 'video_rendering':
      return obj

    default:
      return previewData
  }
}

export function StepRunner({ step }: { step: WorkflowStep }) {
  const runtime = useWorkflowStore((s) => s.runtime[step.name])
  // ── V3: Confirmation Gate integrations ──────────────────────────
  const preStepConfirmData = useWorkflowStore((s) => s.preStepConfirmData)
  const pendingConfirmations = useWorkflowStore((s) => s.pendingConfirmations)
  const lastConfirmationSource = useWorkflowStore((s) => s.lastConfirmationSource)
  const respondPreConfirm = useWorkflowStore((s) => s.respondPreConfirm)
  const confirmStep = useWorkflowStore((s) => s.confirmStep)
  const requestRegenerate = useWorkflowStore((s) => s.requestRegenerate)
  const requestModify = useWorkflowStore((s) => s.requestModify)
  const sendWsMessage = useWorkflowStore((s) => s.sendWsMessage)
  const sessionId = useWorkflowStore((s) => s.sessionId)
  const connectionState = useWorkflowStore((s) => s.connectionState)

  if (!runtime) return null

  // ── V3: Compute pending states ──────────────────────────────────
  // Pre-confirmation: step is preparing AND agent has broadcast need_confirm_before
  const hasPreConfirm =
    runtime.phase === 'preparing' &&
    preStepConfirmData !== null &&
    preStepConfirmData.stepName === step.name

  // Post-confirmation: step is done AND a pending confirmation exists for this step
  const postConfirm = pendingConfirmations.find(
    (pc) => pc.stepName === step.name
  )
  const hasPostConfirm = runtime.phase === 'done' && !!postConfirm && !runtime.error

  // Disabled when the OTHER panel is handling the confirmation
  const otherPanelConfirming =
    lastConfirmationSource !== null &&
    lastConfirmationSource !== 'WorkArea'

  return (
    <div className="step-runner flex-1 overflow-y-auto p-4">
      {/* Phase: Preparing */}
      {runtime.phase === 'preparing' && (
        <div className="preparing-panel space-y-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" role="status" aria-label="加载中" />
            <span className="font-medium">{step.label} — 准备中...</span>
          </div>
          {runtime.preparingContext ? (
            <div className="space-y-2 text-sm text-muted-foreground bg-muted/30 rounded-lg p-3">
              {runtime.preparingContext.inputs && Object.keys(runtime.preparingContext.inputs).length > 0 && (
                <div>
                  <p className="font-medium text-xs uppercase tracking-wide mb-1">输入</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {Object.entries(runtime.preparingContext.inputs).map(([k, v]) => (
                      <li key={k}>
                        <span className="font-medium">{k}:</span> {typeof v === 'string' ? v.slice(0, 120) : JSON.stringify(v).slice(0, 120)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {runtime.preparingContext.constraints && runtime.preparingContext.constraints.length > 0 && (
                <div>
                  <p className="font-medium text-xs uppercase tracking-wide mb-1">约束</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {runtime.preparingContext.constraints.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
              {runtime.preparingContext.agentIntent && (
                <div>
                  <p className="font-medium text-xs uppercase tracking-wide mb-1">Agent 意图</p>
                  <p className="italic">{runtime.preparingContext.agentIntent}</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              正在分析输入和约束，准备开始生成...
            </p>
          )}
        </div>
      )}

      {/* ── V3: Pre-exec Confirmation Gate ───────────────────────── */}
      {hasPreConfirm && (
        <ConfirmationGateBase
          mode="pre"
          stepName={step.name}
          stepIndex={step.index}
          message={preStepConfirmData.sideEffects?.join('; ') || `即将开始 ${step.label}`}
          suggestions={['确认执行', '修改后执行', '取消']}
          source="WorkArea"
          preStepContext={preStepConfirmData}
          isPending={true}
          disabled={otherPanelConfirming}
          lastConfirmationSource={lastConfirmationSource}
          onConfirm={() => {
            // Accept pre-confirmation: tell agent to proceed
            respondPreConfirm(step.name, true, '')
          }}
          onModify={(_feedback, changes) => {
            // Reject with modified params
            respondPreConfirm(step.name, false, _feedback, changes)
          }}
          onRegenerate={(_feedback) => {
            // Treat as reject-with-modify
            respondPreConfirm(step.name, false, _feedback)
          }}
          onCancel={() => {
            // Cancel/dismiss the pre-confirmation
            respondPreConfirm(step.name, false, '用户取消了预确认')
          }}
        />
      )}

      {/* Phase: Running */}
      {runtime.phase === 'running' && (
        <div className="running-panel space-y-3">
          <div className="flex items-center gap-2">
            <span className="animate-pulse text-primary" role="img" aria-label="running">⚡</span>
            <span className="font-medium">{step.label} — 生成中</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-primary h-full rounded-full transition-all duration-500"
              style={{ width: `${runtime.progressPercent}%` }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {runtime.progressMessage || '处理中...'}
          </p>
          {runtime.streamedOutput && (
            <pre className="text-sm bg-muted/50 rounded p-3 max-h-48 overflow-y-auto whitespace-pre-wrap">
              {runtime.streamedOutput}
              <span className="animate-pulse">▌</span>
            </pre>
          )}
        </div>
      )}

      {/* Phase: Done — Error state (actions are in StepActions) */}
      {runtime.phase === 'done' && runtime.error && (
        <div className="result-panel space-y-3">
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 text-destructive">
            <p className="font-medium">步骤执行出错</p>
            <p className="text-sm mt-1">{runtime.error}</p>
          </div>
        </div>
      )}

      {/* Phase: Done — Success state */}
      {runtime.phase === 'done' && !runtime.error && (
        <DoneSuccessPanel step={step} runtime={runtime} />
      )}

      {/* ── V3: Post-exec Confirmation Gate ──────────────────────── */}
      {hasPostConfirm && (
        <ConfirmationGateBase
          mode="post"
          stepName={step.name}
          stepIndex={step.index}
          message={postConfirm.message}
          suggestions={postConfirm.suggestions}
          source="WorkArea"
          stepResult={runtime.result ?? undefined}
          isPending={true}
          disabled={otherPanelConfirming}
          lastConfirmationSource={lastConfirmationSource}
          onConfirm={() => {
            // Confirm the step — delegate to store action
            confirmStep(step.index)
            if (connectionState === 'connected') {
              sendWsMessage({ type: 'user:confirm', step: step.name })
            } else {
              fetch(`/api/pipeline/confirm/${sessionId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ step: step.name }),
              }).catch(() => {})
            }
          }}
          onModify={(_feedback, changes) => {
            // Request modification
            requestModify(step.index, changes ?? {})
            if (connectionState === 'connected') {
              sendWsMessage({
                type: 'user:modify',
                step: step.name,
                changes: changes ?? {},
                feedback: _feedback,
              })
            }
          }}
          onRegenerate={(_feedback) => {
            // Request regeneration
            requestRegenerate(step.index, _feedback)
            if (connectionState === 'connected') {
              sendWsMessage({
                type: 'user:regenerate',
                step: step.name,
                feedback: _feedback,
              })
            }
          }}
          onCancel={() => {
            // Dismiss the confirmation without action
            useWorkflowStore.getState().setPendingConfirmation(null)
          }}
        />
      )}
    </div>
  )
}

// ── Done Success Panel ─────────────────────────────────────────────────

function DoneSuccessPanel({
  step,
  runtime,
}: {
  step: WorkflowStep
  runtime: import('@/stores/types').StepRuntime
}) {
  const artifactData = useStepResultData(
    step.name,
    runtime.result?.previewData,
  )
  const Panel = STEP_RESULT_COMPONENTS[step.name]
  const hasPanel =
    Panel !== undefined &&
    artifactData !== undefined &&
    artifactData !== null &&
    // Guard: arrays/strings with no content shouldn't render specialized panel
    !(
      (Array.isArray(artifactData) && artifactData.length === 0) ||
      (typeof artifactData === 'string' && artifactData.length === 0) ||
      (typeof artifactData === 'object' &&
        !Array.isArray(artifactData) &&
        Object.keys(artifactData as Record<string, unknown>).length === 0)
    )

  const artifactPaths: string[] = runtime.result?.artifactPaths ?? []

  // Derive a data-type label for the summary line
  const dataKindLabel = useMemo(() => {
    if (!hasPanel) return null
    if (Array.isArray(artifactData)) {
      const first = (artifactData as unknown[])[0]
      if (first && typeof first === 'object' && 'identifier' in (first as object))
        return '角色'
      if (first && typeof first === 'object' && 'shot_count' in (first as object))
        return '场景'
      if (first && typeof first === 'object' && 'shots' in (first as object))
        return '分镜'
      if (first && typeof first === 'object' && 'view' in (first as object))
        return '肖像'
      return `共 ${(artifactData as unknown[]).length} 项`
    }
    if (typeof artifactData === 'string') return '故事文本'
    if (
      typeof artifactData === 'object' &&
      artifactData !== null &&
      'finalVideoUrl' in (artifactData as object)
    )
      return '视频'
    return null
  }, [artifactData, hasPanel])

  return (
    <div className="result-panel space-y-4">
      {/* Header with checkmark */}
      <div className="flex items-center gap-2">
        <span
          className="text-green-500 text-lg shrink-0"
          role="img"
          aria-label="完成"
        >
          ✅
        </span>
        <h3 className="font-semibold text-lg">{step.label} — 完成</h3>
      </div>

      {/* Summary text */}
      {runtime.result?.summary && (
        <p className="text-sm text-muted-foreground bg-muted/30 rounded-lg p-3 leading-relaxed">
          {runtime.result.summary}
        </p>
      )}

      {/* File generation count */}
      {artifactPaths.length > 0 && (
        <p className="text-xs text-muted-foreground">
          生成 {artifactPaths.length} 个文件
          {dataKindLabel && (
            <span className="ml-1">· {dataKindLabel}</span>
          )}
        </p>
      )}

      {/* Specialized result panel or generic file list */}
      {hasPanel ? (
        <Suspense
          key={step.name}
          fallback={
            <div className="p-4 text-muted-foreground text-sm">
              加载结果面板...
            </div>
          }
        >
          <Panel data={artifactData} step={step} />
        </Suspense>
      ) : artifactPaths.length > 0 ? (
        <div className="bg-card border rounded-lg p-4">
          <h4 className="font-medium text-sm mb-2">生成文件</h4>
          <ul className="text-xs text-muted-foreground space-y-1">
            {artifactPaths.map((p, i) => (
              <li key={i} className="font-mono break-all">
                {p}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          该步骤已完成，暂无详细结果数据。
        </p>
      )}
    </div>
  )
}
