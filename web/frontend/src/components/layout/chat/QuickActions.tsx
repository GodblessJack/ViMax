import { Film, Wand2 } from 'lucide-react'
import { PRESET_STYLES } from '@/lib/constants'

export type QuickActionsProps = {
  /** Step 1: show style selection chips */
  showStylePicker?: boolean
  onStyleSelect?: (styleKey: string) => void
  /** Step 1: show start planning button */
  showStartPlanning?: boolean
  onStartPlanning?: () => void
  onRestartIdea?: () => void
}

function styleDisplayName(key: string): string {
  const found = PRESET_STYLES.find((s) => s.key === key)
  return found ? `${found.emoji} ${found.name}` : key
}

export function QuickActions({
  showStylePicker,
  onStyleSelect,
  showStartPlanning,
  onStartPlanning,
  onRestartIdea,
}: QuickActionsProps) {
  return (
    <>
      {/* Style selection chips */}
      {showStylePicker && (
        <div className="flex flex-wrap gap-1.5 px-1 pb-4">
          {PRESET_STYLES.map((s) => (
            <button
              key={s.key}
              onClick={() => onStyleSelect?.(s.key)}
              className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1.5 text-xs hover:border-primary hover:bg-primary-light transition-all active:scale-95"
            >
              <span>{s.emoji}</span>
              <span>{s.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Start planning + restart */}
      {showStartPlanning && (
        <div className="flex gap-1.5 px-1 pb-4">
          <button
            onClick={onStartPlanning}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary-light text-primary px-3 py-1.5 text-xs font-medium hover:bg-primary hover:text-primary-foreground transition-all active:scale-95"
          >
            <Film className="h-3 w-3" />
            开始规划
          </button>
          {onRestartIdea && (
            <button
              onClick={onRestartIdea}
              className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-all active:scale-95"
            >
              重新描述
            </button>
          )}
        </div>
      )}

      {/* Full start planning button */}
      {showStartPlanning && (
        <div className="text-center pt-2">
          <button
            onClick={onStartPlanning}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:brightness-90 transition-all shadow-sm hover:shadow-md active:scale-[0.98]"
          >
            <Wand2 className="h-4 w-4" />
            开始 AI 规划
          </button>
        </div>
      )}
    </>
  )
}
