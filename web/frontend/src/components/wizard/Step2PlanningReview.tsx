import { useState } from 'react'
import { RefreshCw, ChevronRight, Edit3, CheckCircle2 } from 'lucide-react'
import { StepRunnerPanel } from '@/components/StepRunner/StepRunnerCard'
import { useWorkflowStore } from '@/stores/workflowStore'
import type { WorkflowStepName } from '@/stores/types'

const PLAN_STEPS: WorkflowStepName[] = ['story_generation', 'character_extraction', 'script_writing']

type Step2Props = {
  story: string
  setStory: (v: string) => void
  characters: { idx: number; identifier: string; static_features: string }[]
  scenes: { index: number; title: string; shot_count: number }[]
  loading: boolean
  error: string
  onRegenerate: () => void
  onConfirm: () => void
  onCancel?: () => void
}

export default function Step2PlanningReview({
  story, setStory, characters, scenes, loading, error,
  onRegenerate, onConfirm, onCancel,
}: Step2Props) {
  const [editingStory, setEditingStory] = useState(false)
  const pendingConfirm = useWorkflowStore(s => s.pendingConfirmation)
  const sendEvent = useWorkflowStore(s => s.sendWsMessage)

  return (
    <div className="page-enter">
      <h2 className="text-xl font-bold mb-1">AI 规划审阅</h2>
      <p className="text-sm text-muted-foreground mb-6">逐步生成：故事 → 角色 → 剧本，每步可确认修改</p>

      {error && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold mb-1">规划失败</p>
          <p className="text-xs whitespace-pre-wrap mb-3">{error}</p>
          <button
            onClick={onRegenerate}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700 transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            点击重试
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {/* Real step progress from WorkflowStore */}
          <StepRunnerPanel filterSteps={PLAN_STEPS} />

          {/* Confirmation prompt when a step needs user input */}
          {pendingConfirm && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm">
              <p className="font-medium text-blue-800 mb-2">{pendingConfirm.message}</p>
              <div className="flex gap-2 flex-wrap">
                {pendingConfirm.suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      sendEvent?.({
                        type: 'user:confirm',
                        step: pendingConfirm.stepName,
                        payload: {},
                      } as any)
                    }}
                    className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {onCancel && (
            <div className="text-center mt-4">
              <button
                onClick={onCancel}
                className="text-sm text-muted-foreground hover:text-destructive transition-colors underline underline-offset-4"
              >
                取消规划
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Story */}
          <div className="rounded-xl border bg-card p-5 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2">
                <span className="text-lg">📖</span> 故事
              </h3>
              <button
                onClick={() => setEditingStory(!editingStory)}
                className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <Edit3 className="h-3 w-3" />
                {editingStory ? '完成' : '编辑'}
              </button>
            </div>
            {editingStory ? (
              <textarea
                value={story}
                onChange={e => setStory(e.target.value)}
                className="w-full h-28 rounded-lg border p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            ) : (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {story || '等待 AI 生成...'}
              </p>
            )}
          </div>

          {/* Characters */}
          <div className="rounded-xl border bg-card p-5 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2">
                <span className="text-lg">👥</span> 角色 ({characters.length})
              </h3>
            </div>
            <div className="flex gap-2 flex-wrap">
              {characters.map((c, i) => (
                <div
                  key={`char-${i}`}
                  className="rounded-lg bg-muted px-3.5 py-2 text-sm border border-border/50"
                >
                  <span className="font-semibold">{c.identifier}</span>
                  {c.static_features && (
                    <span className="text-muted-foreground ml-1 text-xs">
                      — {c.static_features.slice(0, 30)}
                    </span>
                  )}
                </div>
              ))}
              {characters.length === 0 && (
                <p className="text-sm text-muted-foreground">等待 AI 生成角色...</p>
              )}
            </div>
          </div>

          {/* Scenes */}
          <div className="rounded-xl border bg-card p-5 mb-6">
            <h3 className="font-semibold flex items-center gap-2 mb-3">
              <span className="text-lg">📺</span> 分集结构 ({scenes.length} 集)
            </h3>
            <div className="space-y-1">
              {scenes.map(s => (
                <div
                  key={s.index}
                  className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors text-sm"
                >
                  <span className="font-medium">第{s.index + 1}集：{s.title}</span>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    {s.shot_count} 镜头
                  </span>
                </div>
              ))}
              {scenes.length === 0 && (
                <p className="text-sm text-muted-foreground">等待 AI 生成分集结构...</p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onRegenerate}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-40"
            >
              <RefreshCw className="h-4 w-4" />
              重新生成
            </button>
            <button
              onClick={onConfirm}
              disabled={loading || !story}
              className="flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:brightness-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
            >
              确认，查看分镜
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </>
      )}
    </div>
  )
}