import { Sparkles } from 'lucide-react'

type ChatMessageProps = {
  role: 'user' | 'ai' | 'system'
  text: string
}

/** Simple markdown-like renderer: **bold**, newlines → <br/>, `code` */
function renderText(text: string) {
  // Split into segments: bold, inline code, plain text
  const segments: { type: 'text' | 'bold' | 'code'; content: string }[] = []
  let remaining = text
  let lastIndex = 0

  // Match **bold** or `code`
  const regex = /(\*\*([^*]+)\*\*)|(`([^`]+)`)/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(remaining)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: remaining.slice(lastIndex, match.index) })
    }
    if (match[1]) {
      segments.push({ type: 'bold', content: match[2] })
    } else if (match[3]) {
      segments.push({ type: 'code', content: match[4] })
    }
    lastIndex = regex.lastIndex
  }
  // Remaining text
  if (lastIndex < remaining.length) {
    segments.push({ type: 'text', content: remaining.slice(lastIndex) })
  }

  if (segments.length === 0) {
    segments.push({ type: 'text', content: text })
  }

  return segments.map((seg, i) => {
    // Split by newlines within text segments
    if (seg.type === 'text') {
      const lines = seg.content.split('\n')
      return lines.map((line, j) => (
        <span key={`${i}-${j}`}>
          {j > 0 && <br />}
          {line}
        </span>
      ))
    }
    if (seg.type === 'bold') {
      return <strong key={i}>{seg.content}</strong>
    }
    if (seg.type === 'code') {
      return (
        <code key={i} className="px-1 py-0.5 rounded bg-muted text-[0.85em] font-mono">
          {seg.content}
        </code>
      )
    }
    return null
  })
}

export function ChatMessage({ role, text }: ChatMessageProps) {
  if (role === 'system') {
    return (
      <div className="rounded-xl bg-primary/10 border border-primary/20 px-4 py-2.5 text-xs text-center font-medium text-primary">
        {text}
      </div>
    )
  }

  const isAi = role === 'ai'

  return (
    <div className={`flex gap-2.5 ${isAi ? '' : 'justify-end'}`}>
      {isAi && (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-0.5">
          <Sparkles className="h-3 w-3 text-primary" />
        </div>
      )}

      <div className={`text-sm leading-relaxed max-w-[85%] ${
        isAi
          ? 'rounded-2xl rounded-tl-sm bg-muted/60 px-3.5 py-2.5'
          : 'rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-3.5 py-2.5'
      }`}>
        {renderText(text)}
      </div>

      {!isAi && (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted mt-0.5">
          <span className="text-[10px] font-semibold text-muted-foreground">你</span>
        </div>
      )}
    </div>
  )
}

/** Animated typing indicator */
export function TypingIndicator() {
  return (
    <div className="flex gap-2.5">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Sparkles className="h-3 w-3 text-primary" />
      </div>
      <div className="flex items-center gap-1 px-4 py-3 rounded-2xl rounded-tl-sm bg-muted/60">
        <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  )
}
