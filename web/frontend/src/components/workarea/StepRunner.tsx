import { Suspense, useMemo } from 'react'
import type { WorkflowStep, WorkflowStepName } from '@/stores/types'
import { useWorkflowStore } from '@/stores/workflowStore'
import { STEP_RESULT_COMPONENTS } from './panels/index'

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

  // Server-supplied previewData takes priority
  if (previewData !== undefined && previewData !== null) return previewData

  // Fall back to step-specific store data
  switch (stepName) {
    case 'story_generation':
      return story ? story : undefined
    case 'character_extraction':
      return characters.length > 0 ? characters : undefined
    case 'script_writing':
      return scenes.length > 0 ? scenes : undefined
    case 'storyboard_design':
      return storyboardScenes.length > 0 ? storyboardScenes : undefined
    case 'character_portraits':
      return artifacts['portraits'] ?? undefined
    case 'video_rendering':
      return finalVideoUrl
        ? { finalVideoUrl }
        : artifacts['final_video']
          ? artifacts['final_video']
          : undefined
    default:
      return undefined
  }
}

export function StepRunner({ step }: { step: WorkflowStep }) {
  const runtime = useWorkflowStore((s) => s.runtime[step.name])

  if (!runtime) return null

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
