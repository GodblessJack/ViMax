import { Send } from 'lucide-react'

export type ChatInputProps = {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  sending: boolean
  placeholder?: string
}

export function ChatInput({ value, onChange, onSend, sending, placeholder }: ChatInputProps) {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSend() }}
      className="p-4 border-t bg-sidebar/80 backdrop-blur-sm shrink-0"
    >
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="输入消息"
          placeholder={placeholder ?? '输入你的问题或修改意见...'}
          className="flex-1 rounded-xl border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-all placeholder:text-muted-foreground/50"
          autoFocus
        />
        <button
          type="submit"
          disabled={!value.trim() || sending}
          aria-label="发送消息"
          className="rounded-xl bg-primary px-3.5 py-2.5 text-primary-foreground hover:brightness-90 disabled:opacity-40 transition-all shrink-0"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </form>
  )
}
