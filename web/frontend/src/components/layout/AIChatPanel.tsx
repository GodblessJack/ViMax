import { useState, useRef, useEffect, useMemo } from 'react'
import { Send, Film, Wand2 } from 'lucide-react'
import type { WizardStep } from '@/lib/types'
import type { ChatMessage as StoreChatMessage, AgentSuggestion } from '@/stores/types'
import { PRESET_STYLES } from '@/lib/constants'
import { ChatMessage, TypingIndicator } from '@/components/ui/ChatMessage'

function styleDisplayName(key: string): string {
  const found = PRESET_STYLES.find(s => s.key === key)
  return found ? `${found.emoji} ${found.name}` : key
}

type Message = { role: 'user' | 'ai' | 'system'; text: string }

type AIChatPanelProps = {
  step: WizardStep
  sessionId: string | null
  idea: string
  style: string
  onIdeaExtracted: (idea: string) => void
  onStyleExtracted: (style: string) => void
  onStartPlanning: () => void
  onSendMessage?: (message: string) => Promise<string | null>
  /* Context for data-driven greetings */
  storyChars?: number
  characterCount?: number
  sceneCount?: number
  totalShots?: number
  /* ── NEW: Store wiring (additive alongside existing props) ── */
  storeChatMessages?: StoreChatMessage[]
  storeAgentSuggestions?: AgentSuggestion[]
  onWSSendMessage?: (message: string) => void
}

function buildGreeting(step: WizardStep, ctx: {
  storyChars?: number; characterCount?: number; sceneCount?: number; totalShots?: number
}): string {
  switch (step) {
    case 1:
      return `你好！我是你的 AI 创作助手 🎬\n\n让我们开始创作你的短剧吧。\n\n**先告诉我：你想拍一个什么样的短剧？**\n比如：故事内容、风格偏好、时长、场景...想到什么说什么。`
    case 2: {
      const parts: string[] = []
      if (ctx.storyChars) parts.push(`故事文本（${ctx.storyChars} 字）`)
      if (ctx.characterCount) parts.push(`${ctx.characterCount} 个角色`)
      if (ctx.sceneCount && ctx.totalShots) parts.push(`${ctx.sceneCount} 集共 ${ctx.totalShots} 个镜头`)
      const detail = parts.length > 0 ? `\n\n已生成：${parts.join(' · ')}。` : ''
      return `我已经根据你的创意生成了故事大纲、角色设定和分集结构。${detail}\n你可以在左侧查看，想调整什么直接告诉我。`
    }
    case 3: {
      const shots = ctx.totalShots ? `\n\n当前共 ${ctx.totalShots} 个镜头，点击左侧镜头查看详情。` : ''
      return `分镜已生成。${shots}\n有想改的告诉我——比如"第3个镜头换成近景"。`
    }
    case 4:
      return '正在生成角色形象和视频片段，完成后你可以预览。有什么问题随时问我。'
    case 5:
      return '视频已生成！可以在左侧预览和下载。想创作下一个短剧吗？'
  }
}

const STYLE_KEYWORDS: Record<string, string> = {
  '武侠': 'wuxia', '古风': 'ancient', '古代': 'ancient',
  '现代': 'modern', '都市': 'modern', '城市': 'modern',
  '悬疑': 'suspense', '恐怖': 'suspense', '惊悚': 'suspense',
  '喜剧': 'comedy', '搞笑': 'comedy', '幽默': 'comedy',
  '写实': 'realistic', '真实': 'realistic', '纪录片': 'realistic',
  '动漫': 'anime', '二次元': 'anime', '动画': 'anime',
}

function extractStyle(text: string): string | null {
  for (const [keyword, style] of Object.entries(STYLE_KEYWORDS)) {
    if (text.includes(keyword)) return style
  }
  return null
}

export default function AIChatPanel({
  step, onIdeaExtracted, onStyleExtracted, onStartPlanning,
  onSendMessage,
  storyChars, characterCount, sceneCount, totalShots,
  storeChatMessages, storeAgentSuggestions, onWSSendMessage,
}: AIChatPanelProps) {
  const greeting = buildGreeting(step, { storyChars, characterCount, sceneCount, totalShots })
  const [messages, setMessages] = useState<Message[]>(() => [
    { role: 'ai', text: greeting },
  ])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [ideaConfirmed, setIdeaConfirmed] = useState(step > 1)
  const [styleConfirmed, setStyleConfirmed] = useState(step > 1)
  const bottomRef = useRef<HTMLDivElement>(null)
  const prevStepRef = useRef(step)

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Refs for latest context data (avoid triggering effect on data changes)
  const ctxRef = useRef({ storyChars, characterCount, sceneCount, totalShots })

  useEffect(() => {
    ctxRef.current = { storyChars, characterCount, sceneCount, totalShots }
  }, [storyChars, characterCount, sceneCount, totalShots])

  // ── NEW: Merge store chat messages alongside local messages ──
  // Store messages (from agent WS events) are appended after local messages.
  // Local messages preserve the Step 1 UX flow (idea/style extraction).
  const allMessages = useMemo(() => {
    const merged: { role: 'user' | 'ai' | 'system'; text: string; id?: string; isStore?: boolean }[] = [...messages]
    if (storeChatMessages && storeChatMessages.length > 0) {
      // Add store-originated agent messages that aren't already in local messages
      for (const sm of storeChatMessages) {
        const alreadyPresent = merged.some(
          (m) => m.text === sm.content && m.role === (sm.role === 'agent' ? 'ai' : sm.role)
        )
        if (!alreadyPresent) {
          merged.push({
            role: sm.role === 'agent' ? 'ai' : sm.role === 'system' ? 'system' : 'user',
            text: sm.content,
            id: sm.id,
            isStore: true,
          })
        }
      }
    }
    return merged
  }, [messages, storeChatMessages])

  // Add context-aware greetings when step advances
  useEffect(() => {
    if (step !== prevStepRef.current && step > 1) {
      const greeting = buildGreeting(step, ctxRef.current)
      setMessages(prev => [...prev, { role: 'ai', text: greeting }])
    }
    prevStepRef.current = step
  }, [step])

  // Extract idea from user message (simple heuristic: first substantial message = idea)
  function extractIdea(text: string): string {
    // Clean up common conversational prefixes
    let cleaned = text
      .replace(/^(我想|我要|我想拍|我想做一个|帮我|请|你好|嗨|hi|hey)\s*/i, '')
      .replace(/[。！？.!?]$/, '')
      .trim()

    if (cleaned.length < 5) cleaned = text.trim()
    return cleaned
  }

  async function send() {
    if (!input.trim() || sending) return
    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: userMsg }])
    setSending(true)

    // ── NEW: Also send via WS when available ──
    if (onWSSendMessage) {
      onWSSendMessage(userMsg)
    }

    try {
      // ── Step 1 logic: extract idea and style from conversation ──
      if (step === 1) {
        if (!ideaConfirmed) {
          // First message = idea
          const extractedIdea = extractIdea(userMsg)
          onIdeaExtracted(extractedIdea)

          // Check for style in the same message
          const detectedStyle = extractStyle(userMsg)
          if (detectedStyle) {
            onStyleExtracted(detectedStyle)
            setStyleConfirmed(true)
          }

          setIdeaConfirmed(true)
          setMessages(prev => [...prev, {
            role: 'ai',
            text: `收到！我理解你想拍：**"${extractedIdea}"**\n\n${detectedStyle
              ? `我检测到风格倾向：**${styleDisplayName(detectedStyle)}**`
              : '接下来：你希望短剧是什么**风格**？\n\n可选：🎭 武侠风 · 🏛️ 古风 · 🌆 现代风 · 🔮 悬疑风 · 😂 喜剧风\n\n也可以描述你想要的风格感觉。'}`
          }])
        } else if (!styleConfirmed) {
          // Second message = style
          const detectedStyle = extractStyle(userMsg)
          if (detectedStyle) {
            onStyleExtracted(detectedStyle)
            setStyleConfirmed(true)
            setMessages(prev => [...prev, {
              role: 'ai',
              text: `好的！风格确认为 **${styleDisplayName(detectedStyle)}** 🎬\n\n一切就绪！确认开始 AI 规划吗？`,
            }])
          } else {
            // Use the text as custom style
            onStyleExtracted(userMsg)
            setStyleConfirmed(true)
            setMessages(prev => [...prev, {
              role: 'ai',
              text: `好的！我记录下你的风格偏好：**"${userMsg}"**\n\n一切就绪！确认开始 AI 规划吗？\n\n> 点击下方按钮或回复"开始"`,
            }])
          }
        } else if (userMsg.includes('开始') || userMsg.includes('确认') || userMsg.includes('好') || userMsg.includes('行') || userMsg.includes('可以')) {
          // User confirmed — trigger planning
          setMessages(prev => [...prev, {
            role: 'system', text: '🚀 AI 开始规划中...',
          }])
          onStartPlanning()
        } else {
          // Continue conversation
          const reply = onSendMessage ? await onSendMessage(userMsg) : null
          if (reply) {
            setMessages(prev => [...prev, { role: 'ai', text: reply }])
          }
        }
      } else {
        // Steps 2-5: general AI chat
        const reply = onSendMessage ? await onSendMessage(userMsg) : null
        if (reply) {
          setMessages(prev => [...prev, { role: 'ai', text: reply }])
        } else {
          setMessages(prev => [...prev, {
            role: 'ai',
            text: '收到！你可以直接告诉我想要修改什么，比如"换一个角色名字"或"第3个镜头太暗了"。',
          }])
        }
      }
    } catch {
      setMessages(prev => [...prev, { role: 'ai', text: '抱歉，AI 服务暂不可用，请稍后重试。' }])
    } finally {
      setSending(false)
    }
  }

  return (
    <aside className="w-[380px] border-l border-r bg-sidebar flex-shrink-0 flex flex-col h-full">
      {/* Header — fixed, no collapse */}
      <div className="flex items-center gap-2 px-4 py-3.5 border-b bg-sidebar/80 backdrop-blur-sm shrink-0">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
          <Wand2 className="h-3.5 w-3.5 text-primary-foreground" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-sidebar-foreground">AI 创作助手</h3>
          <p className="text-[10px] text-muted-foreground">
            {step === 1 ? '描述创意，我来帮你' :
             step === 2 ? '审阅规划结果' :
             step === 3 ? '调整分镜细节' :
             step === 4 ? '监控生成进度' : '预览导出成品'}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {allMessages.map((m, i) => (
          <ChatMessage key={m.id ?? i} role={m.role} text={m.text} />
        ))}

        {sending && <TypingIndicator />}

        {/* Quick reply chips — style selection */}
        {step === 1 && ideaConfirmed && !styleConfirmed && (
          <div className="flex flex-wrap gap-1.5 px-1 pb-4">
            {PRESET_STYLES.map(s => (
              <button
                key={s.key}
                onClick={() => {
                  setMessages(prev => [
                    ...prev,
                    { role: 'user', text: `${s.emoji} ${s.name}` },
                    { role: 'ai', text: `好的！风格确认为 **${s.emoji} ${s.name}** 🎬\n\n一切就绪！确认开始 AI 规划吗？` },
                  ])
                  onStyleExtracted(s.key)
                  setStyleConfirmed(true)
                }}
                className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1.5 text-xs hover:border-primary hover:bg-primary-light transition-all active:scale-95"
              >
                <span>{s.emoji}</span>
                <span>{s.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* Quick reply chips — confirm to start */}
        {step === 1 && ideaConfirmed && styleConfirmed && (
          <div className="flex gap-1.5 px-1 pb-4">
            <button
              onClick={() => {
                setMessages(prev => [...prev, { role: 'system', text: '🚀 AI 开始规划中...' }])
                onStartPlanning()
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary-light text-primary px-3 py-1.5 text-xs font-medium hover:bg-primary hover:text-primary-foreground transition-all active:scale-95"
            >
              <Film className="h-3 w-3" />
              开始规划
            </button>
            <button
              onClick={() => {
                setIdeaConfirmed(false)
                setStyleConfirmed(false)
                onIdeaExtracted('')
                onStyleExtracted('')
                setMessages(prev => [...prev,
                  { role: 'user', text: '我想换个创意' },
                  { role: 'ai', text: '没问题！请重新描述你想拍的短剧创意 🎬' },
                ])
              }}
              className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-all active:scale-95"
            >
              重新描述
            </button>
          </div>
        )}

        {/* Start planning button — shows when both idea and style confirmed in Step 1 */}
        {step === 1 && ideaConfirmed && styleConfirmed && (
          <div className="text-center pt-2">
            <button
              onClick={() => {
                setMessages(prev => [...prev, { role: 'system', text: '🚀 AI 开始规划中...' }])
                onStartPlanning()
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:brightness-90 transition-all shadow-sm hover:shadow-md active:scale-[0.98]"
            >
              <Film className="h-4 w-4" />
              开始 AI 规划
            </button>
          </div>
        )}

        {/* ── NEW: Agent suggestions from store (additive alongside existing UI) ── */}
        {storeAgentSuggestions && storeAgentSuggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1 py-2 border-t border-border/40 pt-3 mt-2">
            {storeAgentSuggestions
              .filter((s) => !s.dismissed)
              .slice(0, 3)
              .map((suggestion) => (
                <div
                  key={suggestion.id}
                  className="flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-xs text-muted-foreground"
                >
                  <span>
                    {suggestion.type === 'warning' ? '⚠️' : suggestion.type === 'tip' ? '💡' : suggestion.type === 'question' ? '❓' : '🎯'}
                  </span>
                  <span>{suggestion.message}</span>
                  {suggestion.action && (
                    <button
                      onClick={() => {
                        // Dismiss locally — actual action handled by parent via WS
                      }}
                      className="ml-1 rounded-md bg-primary-light text-primary px-2 py-0.5 text-[10px] font-medium hover:bg-primary hover:text-primary-foreground transition-colors"
                    >
                      {suggestion.action.label}
                    </button>
                  )}
                </div>
              ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input — always visible */}
      <form
        onSubmit={e => { e.preventDefault(); send() }}
        className="p-4 border-t bg-sidebar/80 backdrop-blur-sm shrink-0"
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            aria-label="输入消息"
            placeholder={
              step === 1 && !ideaConfirmed ? '描述你的创意...' :
              step === 1 && !styleConfirmed ? '描述你想要的风格...' :
              '输入你的问题或修改意见...'
            }
            className="flex-1 rounded-xl border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-all placeholder:text-muted-foreground/50"
            autoFocus
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            aria-label="发送消息"
            className="rounded-xl bg-primary px-3.5 py-2.5 text-primary-foreground hover:brightness-90 disabled:opacity-40 transition-all shrink-0"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </aside>
  )
}
