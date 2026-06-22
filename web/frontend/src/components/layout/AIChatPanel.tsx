import { useState, useRef, useEffect, useMemo } from 'react'
import { Wand2, CheckCircle, RotateCcw, MessageSquare, AlertTriangle, Play, PenLine } from 'lucide-react'
import type { WizardStep } from '@/lib/types'
import type { ChatMessage as StoreChatMessage, AgentSuggestion } from '@/stores/types'
import { useWorkflowStore } from '@/stores/workflowStore'
import { ChatMessage, TypingIndicator } from '@/components/ui/ChatMessage'
import { ChatInput, SuggestionBar } from '@/components/layout/chat'

type Message = { role: 'user' | 'ai' | 'system'; text: string }

type AIChatPanelProps = {
  step: WizardStep
  sessionId: string | null
  idea: string
  style: string
  /** @deprecated V3: idea/style extraction is now WS/Agent-driven, not frontend hardcoded */
  onIdeaExtracted?: (idea: string) => void
  /** @deprecated V3: idea/style extraction is now WS/Agent-driven, not frontend hardcoded */
  onStyleExtracted?: (style: string) => void
  onStartPlanning?: () => void
  onSendMessage?: (message: string) => Promise<string | null>
  /* Context for data-driven greetings */
  storyChars?: number
  characterCount?: number
  sceneCount?: number
  totalShots?: number
  /* Store wiring (additive alongside existing props) */
  storeChatMessages?: StoreChatMessage[]
  storeAgentSuggestions?: AgentSuggestion[]
  onWSSendMessage?: (message: string) => void
}

// ── Context-aware greeting (informational, no hardcoded extraction) ────

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

// ── Component ──────────────────────────────────────────────────────────

export default function AIChatPanel({
  step, onStartPlanning,
  onSendMessage,
  storyChars, characterCount, sceneCount, totalShots,
  storeChatMessages, storeAgentSuggestions, onWSSendMessage,
}: AIChatPanelProps) {
  // ── V3: Store subscriptions (confirmation state, suggestions) ────
  const pendingConfirmations = useWorkflowStore((s) => s.pendingConfirmations)
  const preStepConfirmData = useWorkflowStore((s) => s.preStepConfirmData)
  const postStepConfirmData = useWorkflowStore((s) => s.postStepConfirmData)
  const syncState = useWorkflowStore((s) => s.syncState)
  const lastConfirmationSource = useWorkflowStore((s) => s.lastConfirmationSource)
  const storeAgentSuggestionsFromStore = useWorkflowStore((s) => s.agentSuggestions)
  const confirmStep = useWorkflowStore((s) => s.confirmStep)
  const requestRegenerate = useWorkflowStore((s) => s.requestRegenerate)
  const requestModify = useWorkflowStore((s) => s.requestModify)
  const sendWsMessage = useWorkflowStore((s) => s.sendWsMessage)
  const connectionState = useWorkflowStore((s) => s.connectionState)
  const storeSessionId = useWorkflowStore((s) => s.sessionId)
  const respondPreConfirm = useWorkflowStore((s) => s.respondPreConfirm)

  // ── Local state ──────────────────────────────────────────────────
  const greeting = buildGreeting(step, { storyChars, characterCount, sceneCount, totalShots })
  const [messages, setMessages] = useState<Message[]>(() => [
    { role: 'ai', text: greeting },
  ])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  // V3: Pre-confirmation "modify then execute" state
  const [showPreModifyInput, setShowPreModifyInput] = useState(false)
  const [preModifyText, setPreModifyText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const prevStepRef = useRef(step)

  // Context refs (avoid triggering effects on data changes)
  const ctxRef = useRef({ storyChars, characterCount, sceneCount, totalShots })
  useEffect(() => {
    ctxRef.current = { storyChars, characterCount, sceneCount, totalShots }
  }, [storyChars, characterCount, sceneCount, totalShots])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Merge local + store chat messages ────────────────────────────
  const allMessages = useMemo(() => {
    const merged: { role: 'user' | 'ai' | 'system'; text: string; id?: string; isStore?: boolean }[] = [...messages]
    if (storeChatMessages && storeChatMessages.length > 0) {
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

  // Step-advance greeting
  useEffect(() => {
    if (step !== prevStepRef.current && step > 1) {
      const newGreeting = buildGreeting(step, ctxRef.current)
      setMessages(prev => [...prev, { role: 'ai', text: newGreeting }])
    }
    prevStepRef.current = step
  }, [step])

  // ── V3: Compute pending confirmation state ───────────────────────
  const pendingConfirmation = pendingConfirmations.length > 0
    ? pendingConfirmations[pendingConfirmations.length - 1]
    : null

  // Check if other panel (WorkArea) is actively confirming
  const workAreaConfirming = syncState.confirmationState.isPending &&
    lastConfirmationSource === 'WorkArea'

  // ── V3: Confirmation handlers (parity with WorkArea StepActions) ──
  const handleConfirmAfter = () => {
    if (!pendingConfirmation) return
    const stepName = pendingConfirmation.stepName
    const stepIndex = pendingConfirmation.stepIndex

    // Send confirm via WS or REST fallback
    if (connectionState === 'connected' && storeSessionId) {
      sendWsMessage({ type: 'user:confirm', step: stepName })
    } else if (storeSessionId) {
      fetch(`/api/pipeline/confirm/${storeSessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: stepName }),
      }).catch(() => {})
    }
    confirmStep(stepIndex)
  }

  const handleRegenerateAfter = () => {
    if (!pendingConfirmation) return
    requestRegenerate(pendingConfirmation.stepIndex)
    setMessages(prev => [...prev, {
      role: 'system',
      text: `🔄 重新生成 ${pendingConfirmation.stepName}...`,
    }])
  }

  const handleDiscuss = () => {
    if (!pendingConfirmation) return
    const stepLabel = pendingConfirmation.stepName
    const discussMsg = `我想讨论一下 ${stepLabel} 的结果...`
    setMessages(prev => [...prev, { role: 'user', text: discussMsg }])
    if (onWSSendMessage) {
      onWSSendMessage(discussMsg)
    }
  }

  // ── V3: Pre-step confirmation handlers ───────────────────────────
  const handleConfirmBefore = () => {
    if (!preStepConfirmData) return
    respondPreConfirm(preStepConfirmData.stepName, true)
    setMessages(prev => [...prev, {
      role: 'system',
      text: `✅ 已确认执行: ${preStepConfirmData.stepName}`,
    }])
  }

  const handleRejectBefore = () => {
    if (!preStepConfirmData) return
    respondPreConfirm(preStepConfirmData.stepName, false, '用户取消')
    setMessages(prev => [...prev, {
      role: 'system',
      text: `❌ 已取消: ${preStepConfirmData.stepName}`,
    }])
  }

  // V3: "修改后执行" — show modify input, then submit with modified params
  const handleModifyBefore = () => {
    setShowPreModifyInput(true)
    setPreModifyText('')
  }

  const handleSubmitModifyBefore = () => {
    if (!preStepConfirmData) return
    const feedback = preModifyText.trim() || '用户要求修改后执行'
    respondPreConfirm(preStepConfirmData.stepName, false, feedback)
    setShowPreModifyInput(false)
    setPreModifyText('')
    setMessages(prev => [...prev, {
      role: 'system',
      text: `📝 已提交修改请求: ${preStepConfirmData.stepName}\n修改意见: ${feedback}`,
    }])
  }

  const handleCancelModifyBefore = () => {
    setShowPreModifyInput(false)
    setPreModifyText('')
  }

  // ── Send message (no hardcoded extraction — all Agent/WS driven) ──
  async function send() {
    if (!input.trim() || sending) return
    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: userMsg }])
    setSending(true)

    // Send via WS when available
    if (onWSSendMessage) {
      onWSSendMessage(userMsg)
    }

    try {
      // REST fallback for AI reply
      const reply = onSendMessage ? await onSendMessage(userMsg) : null
      if (reply) {
        setMessages(prev => [...prev, { role: 'ai', text: reply }])
      }
    } catch {
      // Silent fallback — WS-driven messages will appear via storeChatMessages
    } finally {
      setSending(false)
    }
  }

  // ── Combined agent suggestions (props + store) ───────────────────
  const allSuggestions = useMemo(() => {
    const combined = [...(storeAgentSuggestions ?? [])]
    for (const s of storeAgentSuggestionsFromStore) {
      if (!combined.some(c => c.id === s.id)) {
        combined.push(s)
      }
    }
    return combined
  }, [storeAgentSuggestions, storeAgentSuggestionsFromStore])

  // ── Render ───────────────────────────────────────────────────────
  return (
    <aside className="w-[380px] border-l border-r bg-sidebar flex-shrink-0 flex flex-col h-full">
      {/* Header */}
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

        {/* ── V3: Pre-step confirmation (before execution) ────────── */}
        {preStepConfirmData && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-800">
                  确认执行: {preStepConfirmData.stepName}
                </p>
                <p className="text-xs text-amber-700 mt-1">
                  预计耗时: {preStepConfirmData.estimatedDuration}
                </p>
                {preStepConfirmData.sideEffects.length > 0 && (
                  <ul className="text-xs text-amber-600 mt-1 list-disc list-inside">
                    {preStepConfirmData.sideEffects.map((se, i) => (
                      <li key={i}>{se}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={handleConfirmBefore}
                disabled={workAreaConfirming}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
              >
                <Play className="h-3 w-3" />
                确认执行
              </button>
              <button
                onClick={handleModifyBefore}
                disabled={workAreaConfirming}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200 transition-colors disabled:opacity-40"
              >
                <PenLine className="h-3 w-3" />
                修改后执行
              </button>
              <button
                onClick={handleRejectBefore}
                disabled={workAreaConfirming}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border hover:bg-muted transition-colors disabled:opacity-40"
              >
                取消
              </button>
              {workAreaConfirming && (
                <span className="text-[10px] text-muted-foreground self-center">
                  WorkArea 正在确认中...
                </span>
              )}
            </div>
            {/* ── V3: Modify-before-execute input ────────────────── */}
            {showPreModifyInput && (
              <div className="space-y-2">
                <textarea
                  value={preModifyText}
                  onChange={(e) => setPreModifyText(e.target.value)}
                  placeholder="输入修改意见（如：调整风格、修改角色设定...）"
                  className="w-full text-xs border border-amber-300 rounded-lg p-2 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none"
                  rows={2}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSubmitModifyBefore}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    提交修改
                  </button>
                  <button
                    onClick={handleCancelModifyBefore}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border hover:bg-muted transition-colors"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── V3: Post-step confirmation (after execution) ────────── */}
        {pendingConfirmation && pendingConfirmation.phase !== 'before' && (
          <div className="rounded-xl border border-primary/20 bg-primary-light/50 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium">
                  {pendingConfirmation.message || '步骤已完成，请确认'}
                </p>
                {pendingConfirmation.suggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {pendingConfirmation.suggestions.map((s, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-2 items-center">
              <button
                onClick={handleConfirmAfter}
                disabled={workAreaConfirming}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
              >
                <CheckCircle className="h-3 w-3" />
                确认，进入下一步
              </button>
              <button
                onClick={handleRegenerateAfter}
                disabled={workAreaConfirming}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border hover:bg-muted transition-colors disabled:opacity-40"
              >
                <RotateCcw className="h-3 w-3" />
                重新生成
              </button>
              <button
                onClick={handleDiscuss}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border hover:bg-muted transition-colors"
              >
                <MessageSquare className="h-3 w-3" />
                讨论
              </button>
              {workAreaConfirming && (
                <span className="text-[10px] text-muted-foreground">
                  WorkArea 正在确认中...
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── V3: Agent suggestions (WS-driven quick actions) ─────── */}
        <SuggestionBar
          suggestions={allSuggestions}
          onAction={(suggestion) => {
            if (suggestion.action?.type === 'confirm' && onStartPlanning) {
              setMessages(prev => [...prev, { role: 'system', text: '🚀 AI 开始规划中...' }])
              onStartPlanning()
            } else if (suggestion.action?.type === 'navigate') {
              // Navigation actions are handled by agent:navigate WS event
            }
          }}
        />

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <ChatInput
        value={input}
        onChange={setInput}
        onSend={send}
        sending={sending}
        placeholder={
          pendingConfirmation
            ? '回复确认或提出修改意见...'
            : '输入你的问题或修改意见...'
        }
      />
    </aside>
  )
}
