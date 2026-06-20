import { Suspense } from 'react'
import type { WorkflowStep } from '@/stores/types'
import { useWorkflowStore } from '@/stores/workflowStore'
import { STEP_RESULT_COMPONENTS } from './panels/index'

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
        <div className="result-panel space-y-3">
          {(() => {
            const Panel = STEP_RESULT_COMPONENTS[step.name]
            const artifactData = runtime.result?.previewData
            if (Panel !== undefined && artifactData !== undefined && artifactData !== null) {
              return (
                <Suspense key={step.name} fallback={<div className="p-4 text-muted-foreground text-sm">加载结果面板...</div>}>
                  {/* TODO: When editing is implemented, panels should write to local state
                      that syncs both to store.artifacts AND server via WS */}
                  <Panel data={artifactData} />
                </Suspense>
              )
            }
            // Fallback to generic summary
            return (
              <div className="bg-card border rounded-lg p-4">
                <h3 className="font-medium text-lg">{step.label} — 完成</h3>
                {runtime.result && (
                  <>
                    <p className="text-sm text-muted-foreground mt-2">
                      {runtime.result.summary}
                    </p>
                    {runtime.result.artifactPaths.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-2">
                        生成 {runtime.result.artifactPaths.length} 个文件
                      </p>
                    )}
                  </>
                )}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
