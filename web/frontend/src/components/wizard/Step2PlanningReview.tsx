import { useState, useEffect } from 'react'
import { RefreshCw, ChevronRight, Edit3, Loader2, CheckCircle2 } from 'lucide-react'

const PLANNING_STAGES = [
  { label: '分析创意需求...', icon: '🔍' },
  { label: '构思故事脉络...', icon: '📖' },
  { label: '设计角色形象...', icon: '👥' },
  { label: '编排分集结构...', icon: '📺' },
  { label: '生成分镜脚本...', icon: '🎬' },
]

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

  return (
    <div className="page-enter">
      <h2 className="text-xl font-bold mb-1">AI 规划审阅</h2>
      <p className="text-sm text-muted-foreground mb-6">检查 AI 生成的故事、角色和分集结构</p>

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
        <PlanningLoading onCancel={onCancel} />
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

// ── Loading animation with stage cycling ──────────────────────────

function PlanningLoading({ onCancel }: { onCancel?: () => void }) {
  const [stageIndex, setStageIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setStageIndex(prev => (prev + 1) % PLANNING_STAGES.length)
    }, 2500)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="space-y-4">
      {/* Progress indicator */}
      <div className="rounded-xl border bg-card p-6 text-center">
        <div className="flex items-center justify-center gap-3 mb-4">
          <Loader2 className="h-6 w-6 text-primary animate-spin" />
          <span className="text-lg font-semibold">AI 正在为你创作...</span>
        </div>

        {/* Stage list */}
        <div className="space-y-2 max-w-sm mx-auto">
          {PLANNING_STAGES.map((stage, i) => {
            const isCurrent = i === stageIndex
            const isPast = i < stageIndex
            return (
              <div
                key={`plan-stage-${i}`}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all duration-500 ${
                  isCurrent
                    ? 'bg-primary-light text-primary font-semibold scale-[1.02]'
                    : isPast
                      ? 'text-muted-foreground/60'
                      : 'text-muted-foreground/30'
                }`}
              >
                <span className="text-lg">{stage.icon}</span>
                <span className="flex-1 text-left">{stage.label}</span>
                {isPast && <CheckCircle2 className="h-4 w-4 text-success" />}
                {isCurrent && <Loader2 className="h-4 w-4 text-primary animate-spin" />}
              </div>
            )
          })}
        </div>

        <p className="text-xs text-muted-foreground mt-4">
          这通常需要 30 秒到 2 分钟，取决于创意复杂度
        </p>
      </div>

      {/* Skeleton placeholders */}
      <div className="rounded-xl border p-5 animate-pulse">
        <div className="skeleton h-5 w-20 mb-3 rounded-md" />
        <div className="skeleton h-4 w-full mb-1.5 rounded-md" />
        <div className="skeleton h-4 w-2/3 rounded-md" />
      </div>

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
  )
}
