import { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight, ArrowLeft, Film } from 'lucide-react'
import type { ShotInfo } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/Skeleton'

type SceneData = {
  index: number
  title: string
  shots: ShotInfo[]
}

type Step3Props = {
  scenes: SceneData[]
  sceneIndex: number
  sceneLoading?: boolean
  onSceneChange: (index: number) => void
  onBack: () => void
  onConfirm: () => void
}

export default function Step3StoryboardReview({
  scenes, sceneIndex, sceneLoading, onSceneChange, onBack, onConfirm,
}: Step3Props) {
  const [expanded, setExpanded] = useState<number | null>(null)
  const currentScene = scenes[sceneIndex]

  return (
    <div className="page-enter">
      <h2 className="text-xl font-bold mb-1">确认分镜</h2>
      <p className="text-sm text-muted-foreground mb-4">
        {scenes.length} 集，共 {scenes.reduce((sum, s) => sum + s.shots.length, 0)} 个镜头
      </p>

      {/* Scene tabs */}
      {scenes.length > 1 && (
        <div className="flex gap-1.5 mb-5 overflow-x-auto pb-1">
          {scenes.map((scene, i) => (
            <button
              key={`scene-tab-${i}`}
              onClick={() => {
                onSceneChange(i)
                setExpanded(null)
              }}
              className={cn(
                'shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium transition-all',
                i === sceneIndex
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground',
              )}
            >
              <Film className="h-3.5 w-3.5 inline mr-1" />
              第{i + 1}集
              <span className="ml-1.5 text-[10px] opacity-70">
                ({scene.shots.length})
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Current scene title */}
      {currentScene && (
        <div className="flex items-center gap-2 mb-3 text-sm">
          <span className="font-semibold">第{sceneIndex + 1}集：</span>
          <span className="text-muted-foreground">{currentScene.title}</span>
        </div>
      )}

      {/* Shots list */}
      {sceneLoading ? (
        <div className="space-y-2 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border bg-card p-4 animate-pulse">
              <div className="skeleton h-4 w-full rounded-md" />
            </div>
          ))}
        </div>
      ) : currentScene && currentScene.shots.length > 0 ? (
        <div className="space-y-1.5 mb-6">
          {currentScene.shots.map((s, i) => (
            <div key={`shot-${i}`} className="rounded-xl border bg-card overflow-hidden transition-all hover:shadow-sm">
              <button
                onClick={() => setExpanded(expanded === i ? null : i)}
                aria-expanded={expanded === i}
                className="flex items-center gap-3 w-full p-3.5 text-left hover:bg-muted/30 transition-colors"
              >
                <span className="text-xs font-mono font-semibold text-primary w-7 shrink-0">
                  #{i + 1}
                </span>
                <span className="text-xs bg-primary-light text-primary rounded-md px-2 py-0.5 font-medium">
                  {s.angle || `机位${s.cam_idx}`}
                </span>
                <span className="text-sm truncate flex-1 font-medium">
                  {(s.visual_desc || '').slice(0, 50)}
                </span>
                {expanded === i
                  ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                }
              </button>

              {expanded === i && (
                <div className="px-4 pb-4 pt-0 border-t border-border/50">
                  <div className="pt-3 space-y-2">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-0.5">画面描述</p>
                      <p className="text-sm leading-relaxed">{s.visual_desc}</p>
                    </div>
                    {s.audio_desc && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-0.5">音频/对白</p>
                        <p className="text-sm leading-relaxed">🎤 {s.audio_desc}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <Film className="h-10 w-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">暂无分镜数据</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          返回修改
        </button>
        <button
          onClick={onConfirm}
          disabled={!currentScene || currentScene.shots.length === 0}
          className="flex-1 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:brightness-90 transition-all shadow-sm disabled:opacity-40"
        >
          开始生成视频 →
        </button>
      </div>
    </div>
  )
}
