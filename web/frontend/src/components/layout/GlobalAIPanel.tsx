import { useState, useRef, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Send, Wand2, Plus, Film, FolderOpen } from 'lucide-react'
import { ChatMessage } from '@/components/ui/ChatMessage'

type Message = { role: 'user' | 'ai'; text: string }

const PAGE_GREETINGS: Record<string, string> = {
  '/': `欢迎回来！我是你的 AI 创作助手 🎬

**快速开始：**
- 说"创建短剧"开始新的创作
- 问"我的作品"查看已有项目
- 任何创作问题，直接问我`,

  '/works': `这是你的作品库 📁

我可以帮你：
- 搜索特定作品
- 继续编辑未完成的项目
- 或者开始全新创作`,

  '/works/': `这是作品详情页 🎬

需要调整这个作品吗？告诉我你想修改什么，或者直接开始新的创作。`,
}

export default function GlobalAIPanel() {
  const location = useLocation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(true) // collapsed by default on non-create pages
  const [messages, setMessages] = useState<Message[]>(() => {
    const greeting = PAGE_GREETINGS[location.pathname]
      || (location.pathname.startsWith('/works/') ? PAGE_GREETINGS['/works/'] : PAGE_GREETINGS['/'])
    return [{ role: 'ai', text: greeting }]
  })
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Reset greeting on page change
  useEffect(() => {
    const greeting = PAGE_GREETINGS[location.pathname]
      || (location.pathname.startsWith('/works/') ? PAGE_GREETINGS['/works/'] : PAGE_GREETINGS['/'])
    setMessages([{ role: 'ai', text: greeting }])
  }, [location.pathname])

  function handleQuickAction(text: string) {
    const lower = text.toLowerCase()
    if (lower.includes('创建') || lower.includes('短剧') || lower.includes('开始')) {
      navigate('/create')
      return
    }
    if (lower.includes('作品') || lower.includes('项目')) {
      navigate('/works')
      return
    }
    // General chat
    setMessages(prev => [
      ...prev,
      { role: 'user', text },
      { role: 'ai', text: `好的！你可以去**创建短剧**开始新创作，或查看**我的作品**继续之前的工作。有什么具体需要帮助的吗？` },
    ])
  }

  async function send() {
    if (!input.trim()) return
    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: userMsg }])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, session_id: '', step: 0 }),
      })
      if (res.ok) {
        const data = await res.json()
        setMessages(prev => [...prev, { role: 'ai', text: data.reply || '收到！' }])
      } else {
        handleQuickAction(userMsg)
      }
    } catch {
      handleQuickAction(userMsg)
    }
  }

  if (collapsed) {
    return (
      <div className="border-l border-r bg-sidebar flex flex-col items-center py-3 w-11 shrink-0 gap-3">
        <button
          onClick={() => setCollapsed(false)}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-[#E84A4F] transition-colors"
          title="打开 AI 助手"
        >
          <Wand2 className="h-4 w-4" />
        </button>
        <div className="flex flex-col gap-1.5">
          <button onClick={() => navigate('/create')} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-primary-light transition-colors" title="创建短剧">
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => navigate('/works')} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-primary-light transition-colors" title="我的作品">
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <aside className="w-[340px] border-l border-r bg-sidebar flex-shrink-0 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-sidebar/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
            <Wand2 className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">AI 助手</h3>
            <p className="text-[10px] text-muted-foreground">随时为你提供帮助</p>
          </div>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="text-muted-foreground/50 hover:text-muted-foreground text-xs transition-colors"
        >
          ◀
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m, i) => (
          <ChatMessage key={i} role={m.role} text={m.text} />
        ))}

        {/* Quick actions */}
        {messages.length <= 1 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => handleQuickAction('创建短剧')}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary-light text-primary px-3 py-1.5 text-xs font-medium hover:bg-primary hover:text-primary-foreground transition-all active:scale-95"
            >
              <Film className="h-3 w-3" />
              创建短剧
            </button>
            <button
              onClick={() => handleQuickAction('我的作品')}
              className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-all active:scale-95"
            >
              <FolderOpen className="h-3 w-3" />
              我的作品
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={e => { e.preventDefault(); send() }}
        className="p-3 border-t bg-sidebar/80 backdrop-blur-sm shrink-0"
      >
        <div className="flex gap-1.5">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="问我任何问题..."
            className="flex-1 rounded-xl border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 transition-all placeholder:text-muted-foreground/50"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-xl bg-primary px-3 py-2 text-primary-foreground hover:bg-[#E84A4F] disabled:opacity-40 transition-all shrink-0"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </aside>
  )
}
