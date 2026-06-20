import type { AgentSuggestion } from '@/stores/types'

export type SuggestionBarProps = {
  suggestions: AgentSuggestion[]
  onDismiss?: (id: string) => void
  onAction?: (suggestion: AgentSuggestion) => void
}

const TYPE_ICON: Record<string, string> = {
  warning: '⚠️',
  tip: '💡',
  question: '❓',
  action: '🎯',
}

export function SuggestionBar({ suggestions, onAction }: SuggestionBarProps) {
  const active = suggestions.filter((s) => !s.dismissed).slice(0, 3)
  if (active.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 px-1 py-2 border-t border-border/40 pt-3 mt-2">
      {active.map((suggestion) => (
        <div
          key={suggestion.id}
          className="flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-xs text-muted-foreground"
        >
          <span>{TYPE_ICON[suggestion.type] ?? '💡'}</span>
          <span>{suggestion.message}</span>
          {suggestion.action && (
            <button
              onClick={() => onAction?.(suggestion)}
              className="ml-1 rounded-md bg-primary-light text-primary px-2 py-0.5 text-[10px] font-medium hover:bg-primary hover:text-primary-foreground transition-colors"
            >
              {suggestion.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
