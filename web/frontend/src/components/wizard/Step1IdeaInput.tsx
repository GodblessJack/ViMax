import { useState } from 'react'
import { Sparkles, Lightbulb, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StyleOption } from '@/lib/types'

export const PRESET_STYLES: StyleOption[] = [
  { key: 'wuxia', name: '武侠风', emoji: '🎭', description: '武侠江湖，快意恩仇' },
  { key: 'ancient', name: '古风', emoji: '🏛️', description: '古色古香，典雅韵味' },
  { key: 'modern', name: '现代风', emoji: '🌆', description: '都市生活，真实质感' },
  { key: 'suspense', name: '悬疑风', emoji: '🔮', description: '紧张氛围，引人入胜' },
  { key: 'comedy', name: '喜剧风', emoji: '😂', description: '轻松幽默，欢乐氛围' },
]

type Step1Props = {
  idea: string
  setIdea: (v: string) => void
  style: string
  setStyle: (v: string) => void
  loading: boolean
  onNext: () => void
  /* AI-extracted preview (from right panel) */
  aiIdea?: string
  aiStyle?: string
}

export default function Step1IdeaInput({
  idea, setIdea, style, setStyle, loading, onNext,
  aiIdea, aiStyle,
}: Step1Props) {
  const [custom, setCustom] = useState('')

  return (
    <div className="page-enter">
      <h2 className="text-xl font-bold mb-1">创作你的短剧</h2>
      <p className="text-sm text-muted-foreground mb-6">
        描述你的创意，也可以在右侧告诉 AI 助手
      </p>

      {/* AI extracted preview — shown when AI has captured idea */}
      {aiIdea && (
        <div className="mb-6 rounded-xl border border-primary/20 bg-primary-light/50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            <span className="text-xs font-semibold text-primary uppercase tracking-wider">
              AI 已识别
            </span>
            <span className="text-[10px] text-muted-foreground">（来自右侧对话）</span>
          </div>
          <p className="text-sm font-medium">{aiIdea}</p>
          {aiStyle && (
            <p className="text-xs text-primary mt-1">
              风格：{(() => { const f = PRESET_STYLES.find(s => s.key === aiStyle); return f ? `${f.emoji} ${f.name}` : aiStyle })()}
            </p>
          )}
        </div>
      )}

      {/* Idea input */}
      <div className="mb-6">
        <label className="text-sm font-semibold mb-2 block">创意描述</label>
        <textarea
          value={idea}
          onChange={e => setIdea(e.target.value)}
          placeholder="例如：我想拍一个关于武松打虎的武侠短剧，1分钟左右，突出万寿山的武侠表演氛围..."
          className="w-full h-32 rounded-xl border p-4 text-sm resize-none bg-background focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-all placeholder:text-muted-foreground/50"
        />
        <p className="text-xs text-muted-foreground mt-1.5">
          <MessageCircle className="h-3 w-3 inline mr-1" />
          描述越具体，AI 生成效果越好。也可以在右侧对话中口述。
        </p>
      </div>

      {/* Style picker */}
      <div className="mb-6">
        <label className="text-sm font-semibold mb-3 block">选择风格</label>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {PRESET_STYLES.map(s => {
            const isSelected = style === s.key
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => { setStyle(s.key); setCustom('') }}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-xl border p-3.5 text-center transition-all duration-150',
                  'hover:border-primary/40 hover:shadow-sm',
                  isSelected
                    ? 'border-primary bg-primary-light shadow-sm ring-1 ring-primary/20'
                    : 'border-border bg-card',
                )}
              >
                <span className="text-2xl">{s.emoji}</span>
                <span className={cn(
                  'text-sm font-medium',
                  isSelected ? 'text-primary' : 'text-foreground',
                )}>
                  {s.name}
                </span>
              </button>
            )
          })}
        </div>

        {/* Custom style */}
        <input
          type="text"
          value={custom}
          onChange={e => { setCustom(e.target.value); setStyle(e.target.value) }}
          placeholder="或输入自定义风格..."
          className="w-full rounded-xl border px-4 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-all placeholder:text-muted-foreground/50"
        />
        {style && !PRESET_STYLES.find(s => s.key === style) && (
          <p className="text-xs text-muted-foreground mt-1">当前风格：{style}</p>
        )}
      </div>

      {/* Submit — primary action */}
      <button
        onClick={onNext}
        disabled={!idea.trim() || loading}
        className="w-full rounded-xl bg-primary py-3 text-primary-foreground hover:bg-[#E84A4F] disabled:opacity-40 disabled:cursor-not-allowed transition-all font-semibold shadow-sm hover:shadow-md active:scale-[0.99]"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            AI 规划中...
          </span>
        ) : (
          <>
            <Sparkles className="h-4 w-4 inline mr-1.5" />
            AI 生成规划 →
          </>
        )}
      </button>
    </div>
  )
}
