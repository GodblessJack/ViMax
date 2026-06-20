import { useState, useCallback, useRef, useEffect } from 'react'
import StepIndicator from '@/components/wizard/StepIndicator'
import { usePipelineWebSocket } from '@/hooks/useWebSocket'
import { cn } from '@/lib/utils'
import { startPlanning, startRendering, getSession } from '@/lib/api'
import type { WizardStep, StyleOption, ShotInfo, CharacterInfo, SceneInfo, StoryboardJsonItem } from '@/lib/types'

const MAX_POLL_MS = 10 * 60 * 1000  // 10 minutes — DeepSeek camera tree can be slow

// ── Step 1: Idea + Style ─────────────────────────────────────────────

const PRESET_STYLES: StyleOption[] = [
  { key: 'wuxia', name: '武侠风', emoji: '🎭', description: '武侠江湖，快意恩仇' },
  { key: 'ancient', name: '古风', emoji: '🏛️', description: '古色古香，典雅韵味' },
  { key: 'modern', name: '现代风', emoji: '🌆', description: '都市生活，真实质感' },
  { key: 'suspense', name: '悬疑风', emoji: '🔮', description: '紧张氛围，引人入胜' },
  { key: 'comedy', name: '喜剧风', emoji: '😂', description: '轻松幽默，欢乐氛围' },
]

function Step1IdeaInput({
  idea, setIdea, style, setStyle, onNext,
}: {
  idea: string; setIdea: (v: string) => void
  style: string; setStyle: (v: string) => void
  onNext: () => void
}) {
  const [custom, setCustom] = useState('')
  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">创意描述</h2>
      <textarea
        value={idea}
        onChange={e => setIdea(e.target.value)}
        placeholder="我想拍一个关于武松打虎的武侠短剧，1分钟左右，突出万寿山的武侠表演..."
        className="w-full h-32 rounded-md border p-3 text-sm resize-none bg-background"
      />
      <p className="text-xs text-muted-foreground mt-1 mb-6">描述越具体，效果越好</p>

      <h2 className="text-lg font-semibold mb-3">选择风格</h2>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {PRESET_STYLES.map(s => (
          <button
            key={s.key}
            onClick={() => setStyle(s.key)}
            className={cn(
              'flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition-colors hover:border-primary',
              style === s.key && 'border-primary bg-primary/5 ring-1 ring-primary'
            )}
          >
            <span className="text-2xl">{s.emoji}</span>
            <span className="text-sm font-medium">{s.name}</span>
          </button>
        ))}
      </div>
      <input
        type="text"
        value={custom}
        onChange={e => { setCustom(e.target.value); setStyle(e.target.value) }}
        placeholder="或自定义风格描述..."
        className="w-full rounded-md border px-3 py-2 text-sm bg-background"
      />

      <div className="mt-8">
        <button
          onClick={onNext}
          disabled={!idea.trim()}
          className="rounded-md bg-primary px-6 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          AI 生成规划 →
        </button>
      </div>
    </div>
  )
}

// ── Step 2: Planning Review ──────────────────────────────────────────

function Step2PlanningReview({
  story, setStory, characters, scenes,
  onRegenerate, onConfirm, loading, error, planPhase,
}: {
  story: string; setStory: (v: string) => void
  characters: { idx: number; identifier: string; static_features: string }[]
  scenes: { index: number; title: string; shot_count: number }[]
  onRegenerate: () => void
  onConfirm: () => void
  loading: boolean
  error: string
  planPhase: string | null
}) {
  const [editingStory, setEditingStory] = useState(false)
  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">AI 规划审阅</h2>

      {/* Live planning phase */}
      {loading && planPhase && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
          <span className="animate-pulse">🔄</span>
          <span>{planPhase}...</span>
        </div>
      )}

      {!loading && !error && story && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
          <span>✅</span>
          <span>规划完成 — {characters.length} 个角色，{scenes.length} 个场景</span>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p className="font-medium mb-1">规划失败</p>
          <p className="text-xs whitespace-pre-wrap">{error}</p>
          <button onClick={onRegenerate} className="mt-2 text-xs text-red-600 underline hover:no-underline">
            点击重试
          </button>
        </div>
      )}

      {/* Story */}
      <div className="mb-4 rounded-lg border p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium">📖 故事</h3>
          <button onClick={() => setEditingStory(!editingStory)} className="text-xs text-primary hover:underline">
            {editingStory ? '完成' : '编辑'}
          </button>
        </div>
        {editingStory ? (
          <textarea value={story} onChange={e => setStory(e.target.value)} className="w-full h-24 rounded border p-2 text-sm" />
        ) : (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{story || '加载中...'}</p>
        )}
      </div>

      {/* Characters */}
      <div className="mb-4 rounded-lg border p-4">
        <h3 className="font-medium mb-2">👥 角色 ({characters.length})</h3>
        <div className="flex gap-2 flex-wrap">
          {characters.map(c => (
            <div key={c.idx} className="rounded bg-muted px-3 py-1 text-sm">
              {c.identifier}: {c.static_features?.slice(0, 20)}
            </div>
          ))}
        </div>
      </div>

      {/* Scenes */}
      <div className="mb-4 rounded-lg border p-4">
        <h3 className="font-medium mb-2">📺 分集 ({scenes.length}集)</h3>
        {scenes.map(s => (
          <div key={s.index} className="flex items-center justify-between py-1 text-sm">
            <span>第{s.index + 1}集：{s.title}</span>
            <span className="text-muted-foreground">{s.shot_count} 镜头</span>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <button onClick={onRegenerate} disabled={loading} className="rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50">
          🔄 重新生成
        </button>
        <button onClick={onConfirm} disabled={loading || !story} className="rounded-md bg-primary px-6 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          确认，查看分镜 →
        </button>
      </div>
    </div>
  )
}

// ── Step 3: Storyboard Review ────────────────────────────────────────

function Step3StoryboardReview({
  allShots, sceneIndex, setSceneIndex, sceneCount, onBack, onConfirm,
}: {
  allShots: Record<number, ShotInfo[]>
  sceneIndex: number
  setSceneIndex: (i: number) => void
  sceneCount: number
  onBack: () => void
  onConfirm: () => void
}) {
  const [expanded, setExpanded] = useState<number | null>(null)
  const shots = allShots[sceneIndex] || []
  return (
    <div>
      <h2 className="text-lg font-semibold mb-2">确认分镜</h2>

      {/* Scene tabs */}
      {sceneCount > 1 && (
        <div className="flex gap-1 mb-4 overflow-x-auto">
          {Array.from({ length: sceneCount }, (_, i) => (
            <button
              key={i}
              onClick={() => { setSceneIndex(i); setExpanded(null) }}
              className={cn(
                'shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                i === sceneIndex && 'bg-primary text-primary-foreground',
                i !== sceneIndex && 'bg-muted hover:bg-accent',
              )}
            >
              场景 {i + 1}
              <span className="ml-1 opacity-60">({allShots[i]?.length || 0}镜)</span>
            </button>
          ))}
        </div>
      )}

      <p className="text-sm text-muted-foreground mb-4">
        第 {sceneIndex + 1} 场景 · {shots.length} 个镜头
      </p>

      <div className="space-y-1 mb-6">
        {shots.map((s, i) => (
          <div key={i} className="rounded-lg border">
            <button
              onClick={() => setExpanded(expanded === i ? null : i)}
              className="flex items-center gap-3 w-full p-3 text-left hover:bg-muted/50 transition-colors"
            >
              <span className="text-xs font-mono text-muted-foreground w-8">#{i + 1}</span>
              <span className="text-xs bg-muted rounded px-1.5 py-0.5">{s.angle || `机位${s.cam_idx}`}</span>
              <span className="text-sm truncate flex-1">{s.visual_desc?.slice(0, 50)}</span>
            </button>
            {expanded === i && (
              <div className="px-3 pb-3 pt-0 border-t">
                <p className="text-sm text-muted-foreground">{s.visual_desc}</p>
                {s.audio_desc && <p className="text-xs text-muted-foreground mt-1">🎤 {s.audio_desc}</p>}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Scene navigation */}
      <div className="flex items-center justify-between mb-4 text-xs text-muted-foreground">
        <button
          onClick={() => setSceneIndex(Math.max(0, sceneIndex - 1))}
          disabled={sceneIndex === 0}
          className="hover:text-foreground disabled:opacity-30"
        >
          ← 上一场景
        </button>
        <span>{sceneIndex + 1} / {sceneCount}</span>
        <button
          onClick={() => setSceneIndex(Math.min(sceneCount - 1, sceneIndex + 1))}
          disabled={sceneIndex >= sceneCount - 1}
          className="hover:text-foreground disabled:opacity-30"
        >
          下一场景 →
        </button>
      </div>

      <div className="flex gap-3">
        <button onClick={onBack} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">
          ← 返回修改
        </button>
        <button onClick={onConfirm} className="rounded-md bg-primary px-6 py-2 text-sm text-primary-foreground hover:bg-primary/90">
          开始生成视频 →
        </button>
      </div>
    </div>
  )
}

// ── Step 4: Generation ───────────────────────────────────────────────

function Step4Generation({
  events, connected,
}: {
  sessionId: string
  events: import('@/lib/types').PipelineEvent[]
  connected: boolean
}) {
  const renderEvents = events.filter(e => e.type === 'render_progress')
  const statusEvents = events.filter(e => e.type === 'pipeline_status')
  const completeEvent = events.find(e => e.type === 'pipeline_complete')
  const errorEvents = events.filter(e => e.type === 'pipeline_error')

  // Track phases that have started/completed
  const startedPhases = new Set(statusEvents.map(e => e.stage))
  const portraitEvents = renderEvents.filter(e => e.stage === 'character_portrait' && e.phase === 'done')
  const totalCharacters = new Set(portraitEvents.map(e => String(e.metadata?.character || ''))).size

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">
        {completeEvent ? '🎉 视频生成完成' : errorEvents.length > 0 ? '⚠️ 生成出错' : '🎬 正在生成视频...'}
      </h2>

      {/* Pipeline errors */}
      {errorEvents.length > 0 && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p className="font-medium">生成出错</p>
          {errorEvents.map((e, i) => (
            <p key={i} className="text-xs mt-1 whitespace-pre-wrap">{e.error}</p>
          ))}
        </div>
      )}

      {/* Visual stage tracker */}
      {!completeEvent && (
        <div className="mb-4 space-y-1.5">
          {[
            { key: 'character_portraits', icon: '🎨', label: '角色肖像生成' },
            { key: 'render_start', icon: '🎥', label: '场景渲染' },
          ].map(phase => {
            const started = startedPhases.has(phase.key) || statusEvents.some(
              e => (e.stage || '').startsWith(phase.key.split('_')[0] + '_scene_')
            )
            const done = phase.key === 'character_portraits'
              ? portraitEvents.length > 0 && statusEvents.some(e => e.stage === 'character_portraits_done')
              : completeEvent
            return (
              <div key={phase.key} className={cn(
                'flex items-center gap-2 rounded px-3 py-2 text-xs border transition-colors',
                done && 'border-green-300 bg-green-50 text-green-700',
                started && !done && 'border-blue-200 bg-blue-50 text-blue-700',
                !started && 'border-dashed text-muted-foreground',
              )}>
                <span>{done ? '✅' : started ? '🔄' : '⏳'}</span>
                <span>{phase.icon}</span>
                <span className="font-medium">{phase.label}</span>
                {started && !done && <span className="animate-pulse ml-auto text-[10px]">进行中</span>}
              </div>
            )
          })}
        </div>
      )}

      {/* Character portraits — grouped by character */}
      {portraitEvents.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium mb-2">🎨 角色肖像 ({totalCharacters} 个角色)</h3>
          <div className="grid grid-cols-3 gap-2">
            {portraitEvents.map((e, i) => (
              <div key={i} className="rounded border overflow-hidden bg-muted/30">
                {e.image_url ? (
                  <img src={e.image_url} alt="" className="w-full aspect-square object-cover" />
                ) : (
                  <div className="w-full aspect-square bg-muted animate-pulse flex items-center justify-center">
                    <span className="text-xs text-muted-foreground">生成中</span>
                  </div>
                )}
                <p className="text-[10px] p-1 truncate text-center">
                  {String(e.metadata?.character || '')} · {String(e.metadata?.view || '')}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Connection + event counter */}
      <div className="flex items-center gap-2 mb-3 text-[10px] text-muted-foreground">
        <div className={cn('h-2 w-2 rounded-full', connected ? 'bg-green-500' : 'bg-yellow-500')} />
        <span>{connected ? `WS 已连接 · ${events.length} 事件` : `重连中 · ${events.length} 事件`}</span>
      </div>

      {/* Generation log */}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground">📋 生成日志</summary>
        <div className="mt-1 max-h-32 overflow-y-auto space-y-0.5 font-mono text-[10px]">
          {events.map((e, i) => (
            <div key={i} className={cn(
              'truncate',
              e.type === 'pipeline_error' && 'text-red-500',
              e.type === 'pipeline_complete' && 'text-green-500 font-medium',
            )}>
              {e.type === 'pipeline_status' && `📡 ${e.stage}: ${e.message || ''}`}
              {e.type === 'render_progress' && `🖼️ ${e.stage} ${e.phase}`}
              {e.type === 'pipeline_error' && `❌ ${e.error}`}
              {e.type === 'pipeline_complete' && `✅ 完成`}
              {e.type === 'artifact_ready' && `📦 ${e.path}`}
            </div>
          ))}
        </div>
      </details>

      {completeEvent && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          ✅ 视频生成完成！{completeEvent.final_video_url && '可预览和下载。'}
        </div>
      )}
    </div>
  )
}

// ── Step 5: Preview Export ──────────────────────────────────────────

function Step5PreviewExport({ sessionId }: { sessionId: string }) {
  const videoUrl = `/api/files/${sessionId}/final_video`
  const downloadUrl = `/api/works/${sessionId}/download`
  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">预览导出</h2>
      <div className="rounded-lg overflow-hidden bg-black mb-4">
        <video controls className="w-full max-h-[400px]" src={videoUrl}>
          Your browser does not support video playback.
        </video>
      </div>
      <div className="flex gap-3">
        <a
          href={downloadUrl}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-2 text-primary-foreground hover:bg-primary/90"
        >
          ⬇ 下载 MP4
        </a>
        <a
          href="/create"
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          创建下一个短剧
        </a>
      </div>
    </div>
  )
}

// ── AI Chat Panel ─────────────────────────────────────────────────────

function AIChatPanel({ step, sessionId, contextHint }: {
  step: WizardStep
  sessionId: string | null
  contextHint: string
}) {
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([
    { role: 'ai', text: '你好！我是 AI 创作助手。我可以帮你完善创意、调整角色、修改分镜。告诉我你想怎么改。' },
  ])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  async function send(msg?: string) {
    const userMsg = (msg || input).trim()
    if (!userMsg || sending) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: userMsg }])
    setSending(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          session_id: sessionId || '',
          step,
          context: contextHint,
        }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'ai', text: data.reply || '(AI 暂时无法响应)' }])
    } catch {
      setMessages(prev => [...prev, { role: 'ai', text: 'AI 服务暂不可用。请检查后端和 API key 配置。' }])
    } finally {
      setSending(false)
    }
  }

  // Quick-action suggestions per step
  const QUICK_ACTIONS: Record<number, string[]> = {
    1: ['推荐一个武侠风格的故事', '我想要悬疑+反转结局', '帮我丰富这个创意'],
    2: ['修改主角的名字', '增加一个反派角色', '调整故事结局'],
    3: ['把镜头改成特写', '调整这个场景的氛围', '增加一个过渡镜头'],
    4: ['我对这个画面不满意', '可以重新生成吗'],
    5: ['给我推荐下一个短剧的创意', '总结这个短剧的亮点'],
  }
  const actions = QUICK_ACTIONS[step] || []

  return (
    <aside className="w-80 border-l bg-sidebar flex-shrink-0 flex flex-col">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <span>💬</span> AI 创作助手
          {sessionId && (
            <span className="ml-auto text-[10px] text-muted-foreground/60 font-normal">
              Step {step}
            </span>
          )}
        </h3>
        {contextHint && (
          <p className="text-[10px] text-muted-foreground/70 mt-1 truncate">
            上下文: {contextHint}
          </p>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 text-xs">
        {messages.map((m, i) => (
          <div key={i} className={cn(
            'rounded-lg p-2',
            m.role === 'ai' ? 'bg-muted/50 mr-4' : 'bg-primary/10 ml-4',
          )}>
            {m.text}
          </div>
        ))}
        {sending && (
          <div className="flex items-center gap-2 text-muted-foreground italic text-xs bg-muted/30 rounded-lg p-2 mr-4">
            <span className="animate-pulse">●</span> AI 思考中...
          </div>
        )}
      </div>

      {/* Quick actions */}
      {actions.length > 0 && (
        <div className="px-3 pb-2 flex gap-1 flex-wrap border-t pt-2">
          {actions.slice(0, 3).map((a, i) => (
            <button
              key={i}
              onClick={() => send(a)}
              disabled={sending}
              className="text-[10px] rounded-full border px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
            >
              {a}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={e => { e.preventDefault(); send() }}
        className="p-3 pt-2 border-t flex gap-1"
      >
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={step === 2 ? '如：修改主角名字...' : step === 3 ? '如：调整镜头角度...' : '输入问题或修改意见...'}
          className="flex-1 rounded-md border px-2 py-1.5 text-xs bg-background"
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50 transition-colors"
        >
          发送
        </button>
      </form>
    </aside>
  )
}

// ── Main Page ────────────────────────────────────────────────────────

export default function CreateDramaPage() {
  const [step, setStep] = useState<WizardStep>(1)
  const [idea, setIdea] = useState('')
  const [style, setStyle] = useState('wuxia')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [planError, setPlanError] = useState('')

  // Step 2 data
  const [story, setStory] = useState('')
  const [characters, setCharacters] = useState<CharacterInfo[]>([])
  const [scenes, setScenes] = useState<SceneInfo[]>([])

  // Step 3 data — shots keyed by scene index
  const [allShots, setAllShots] = useState<Record<number, ShotInfo[]>>({})
  const [currentScene, setCurrentScene] = useState(0)

  // Step 4 data
  const { events, connected, clearEvents } = usePipelineWebSocket(sessionId)

  // ── Step 1 → Step 2: Trigger planning ──────────────────────────────
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollStartRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const handleStartPlanning = useCallback(async () => {
    setLoading(true)
    setStep(2)
    setPlanError('')
    setStory('')
    setCharacters([])
    setScenes([])
    setAllShots({})
    setCurrentScene(0)
    try {
      const resp = await startPlanning({ idea, user_requirement: '', style })
      setSessionId(resp.session_id)
      const sid = resp.session_id
      pollStartRef.current = Date.now()
      // Poll for planning results — fetches all artifacts when planning completes
      pollRef.current = setInterval(async () => {
        try {
          // Max polling timeout guard
          if (Date.now() - pollStartRef.current > MAX_POLL_MS) {
            clearInterval(pollRef.current!)
            if (mountedRef.current) {
              setLoading(false)
              setPlanError('规划超时（超过 5 分钟）。请检查后端服务后重试。')
            }
            return
          }
          const detail = await getSession(sid)
          if (!mountedRef.current) return
          if (detail.stage === 'narrative_planned') {
            clearInterval(pollRef.current!)
            if (!mountedRef.current) return
            setLoading(false)
            // Fetch story
            if (detail.artifact_checklist?.['idea2video/story.txt']) {
              const storyResp = await fetch(`/api/files/${sid}/idea2video/story.txt`)
              if (mountedRef.current) setStory(storyResp.ok ? await storyResp.text() : '')
            }
            // Fetch characters
            if (detail.artifact_checklist?.['idea2video/characters.json']) {
              const charsResp = await fetch(`/api/files/${sid}/idea2video/characters.json`)
              if (mountedRef.current && charsResp.ok) setCharacters(await charsResp.json())
            }
            // Fetch script (array of scene scripts) → build scenes list
            let sceneCount = 0
            if (detail.artifact_checklist?.['idea2video/script.json']) {
              const scriptResp = await fetch(`/api/files/${sid}/idea2video/script.json`)
              if (mountedRef.current && scriptResp.ok) {
                const scriptArr = await scriptResp.json()
                sceneCount = scriptArr.length
                if (mountedRef.current) {
                  setScenes(scriptArr.map((_text: string, i: number) => ({
                    index: i,
                    title: `Scene ${i + 1}`,
                    shot_count: 0, // filled after storyboard load
                  })))
                }
              }
            }
            // Fetch storyboards for all scenes (Step 3)
            // Use local sceneCount, NOT closure-bound `scenes` which is stale after setScenes()
            if (detail.artifact_checklist?.['idea2video/scene_*/storyboard.json'] && sceneCount > 0) {
              const shotsByScene: Record<number, ShotInfo[]> = {}
              for (let si = 0; si < sceneCount; si++) {
                const sbResp = await fetch(`/api/files/${sid}/idea2video/scene_${si}/storyboard.json`)
                if (mountedRef.current && sbResp.ok) {
                  const sb = await sbResp.json()
                  if (Array.isArray(sb) && sb.length > 0) {
                    shotsByScene[si] = sb.map((s: StoryboardJsonItem) => ({
                      idx: s.idx ?? 0,
                      cam_idx: s.cam_idx ?? 0,
                      visual_desc: s.visual_desc ?? '',
                      audio_desc: s.audio_desc ?? '',
                      angle: `机位${s.cam_idx ?? 0}`,
                    }))
                  }
                }
              }
              if (mountedRef.current) setAllShots(shotsByScene)
            }
          } else if (detail.stage === 'error' || detail.stage === 'cancelled') {
            clearInterval(pollRef.current!)
            if (mountedRef.current) {
              setLoading(false)
              const isCancelled = detail.stage === 'cancelled'
              setPlanError(isCancelled
                ? (detail.summary || 'Planning was cancelled')
                : (detail.summary || 'Planning failed with an unknown error'))
            }
          }
        } catch { /* keep polling */ }
      }, 2000)
    } catch (err: unknown) {
      if (mountedRef.current) {
        setLoading(false)
        const msg = err instanceof Error ? err.message : String(err)
        setPlanError(msg)
      }
      console.error('Planning failed:', err)
    }
  }, [idea, style])

  // ── Step 3 → Step 4: Trigger rendering ─────────────────────────────
  const handleStartRendering = useCallback(async () => {
    if (!sessionId) return
    setLoading(true)
    setStep(4)
    setPlanError('')
    try {
      await startRendering({ session_id: sessionId })
      setLoading(false)
    } catch (err: unknown) {
      if (mountedRef.current) {
        setLoading(false)
        const msg = err instanceof Error ? err.message : 'Failed to start rendering'
        setPlanError(msg)
      }
    }
  }, [sessionId])

  // ── Auto-advance to Step 5 ─────────────────────────────────────────
  const isComplete = events.some(e => e.type === 'pipeline_complete')

  // ── Pipeline progress from WS events ──────────────────────────────
  const pipelinePhase = (() => {
    const statuses = events.filter(e => e.type === 'pipeline_status')
    if (statuses.length === 0) return null
    const last = statuses[statuses.length - 1]
    const stage = last.stage || ''
    // Map raw WS stage to human-readable label
    const LABELS: Record<string, string> = {
      develop_story: '生成故事',
      extract_characters: '提取角色',
      write_script: '编写剧本',
      character_portraits: '角色肖像',
      character_portrait: '角色肖像',
    }
    if (LABELS[stage]) return LABELS[stage]
    if (stage.startsWith('plan_scene_')) return `规划场景 ${parseInt(stage.split('_').pop() || '0') + 1}`
    if (stage.startsWith('render_scene_')) return `渲染场景 ${parseInt(stage.split('_').pop() || '0') + 1}`
    if (stage === 'render_start') return '开始渲染'
    if (stage === 'storyboard_ready') return '分镜就绪'
    if (stage === 'character_portraits_done') return '肖像完成'
    return stage ? stage.replace(/_/g, ' ') : null
  })()
  const isPlanning = events.some(e => e.type === 'pipeline_status' && (e.stage || '').startsWith('plan_scene_'))
  const isRendering = events.some(e => e.type === 'pipeline_status' && (e.stage || '').startsWith('render_scene_'))
  const hasPlanError = events.some(e => e.type === 'pipeline_error')

  return (
    <div className="flex h-full">
      {/* Col 2: Pipeline Progress Panel — live WS-driven */}
      <aside className="w-48 border-r bg-sidebar p-3 flex-shrink-0 overflow-y-auto">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">进度</h3>
          {sessionId && connected && (
            <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" title="WS 已连接" />
          )}
        </div>
        <div className="space-y-1">
          {[
            { s: 1, label: '创意输入' },
            { s: 2, label: 'AI 规划', live: isPlanning ? pipelinePhase : undefined },
            { s: 3, label: '确认分镜' },
            { s: 4, label: '视频生成', live: isRendering ? pipelinePhase : undefined },
            { s: 5, label: '预览导出' },
          ].map(item => (
            <div key={item.s}>
              <div
                className={cn(
                  'flex items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors',
                  step === item.s && 'bg-accent font-medium text-accent-foreground',
                  step > item.s && 'text-primary',
                  step < item.s && 'text-muted-foreground',
                )}
              >
                <span className={cn(
                  'flex h-4 w-4 items-center justify-center rounded-full text-[10px] shrink-0',
                  step > item.s && 'bg-primary text-primary-foreground',
                  step === item.s && !hasPlanError && 'bg-primary text-primary-foreground animate-pulse',
                  step === item.s && hasPlanError && 'bg-destructive text-destructive-foreground',
                  step < item.s && 'bg-muted text-muted-foreground',
                )}>
                  {step > item.s ? '✓' : hasPlanError && step === item.s ? '!' : item.s}
                </span>
                <span className="truncate">{item.label}</span>
              </div>
              {/* Live sub-phase */}
              {item.live && (
                <div className="ml-6 text-[10px] text-primary/70 animate-pulse truncate">
                  {item.live}
                </div>
              )}
            </div>
          ))}
        </div>
        {/* Connection + session info */}
        <div className="mt-4 pt-3 border-t space-y-1">
          {sessionId && (
            <>
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <span className={cn('h-1.5 w-1.5 rounded-full', connected ? 'bg-green-500' : 'bg-yellow-500')} />
                {connected ? 'WS 已连接' : 'WS 等待中'}
              </p>
              <p className="text-[10px] font-mono text-muted-foreground truncate">{sessionId.slice(0, 16)}...</p>
            </>
          )}
        </div>
      </aside>

      {/* Col 3: Main Workspace */}
      <div className="flex-1 p-6 overflow-y-auto">
        <StepIndicator
          current={step}
          onStepClick={(s) => { if (s < step) setStep(s) }}
        />

        {step === 1 && (
          <Step1IdeaInput
            idea={idea} setIdea={setIdea}
            style={style} setStyle={setStyle}
            onNext={handleStartPlanning}
          />
        )}

        {step === 2 && (
          <Step2PlanningReview
            story={story} setStory={setStory}
            characters={characters}
            scenes={scenes}
            onRegenerate={handleStartPlanning}
            onConfirm={() => {
              const hasAnyShots = Object.keys(allShots).length > 0
              if (hasAnyShots) {
                setStep(3)
              } else {
                handleStartRendering()
              }
            }}
            loading={loading}
            error={planError}
            planPhase={pipelinePhase}
          />
        )}

        {step === 3 && (
          <Step3StoryboardReview
            allShots={allShots}
            sceneIndex={currentScene}
            setSceneIndex={setCurrentScene}
            sceneCount={scenes.length || Object.keys(allShots).length}
            onBack={() => setStep(2)}
            onConfirm={handleStartRendering}
          />
        )}

        {step === 4 && (
          <>
            {planError && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <p className="font-medium">渲染启动失败</p>
                <p className="text-xs mt-1">{planError}</p>
                <button onClick={handleStartRendering} className="mt-2 text-xs text-red-600 underline hover:no-underline">
                  重试
                </button>
              </div>
            )}
            <Step4Generation
              sessionId={sessionId || ''}
              events={events}
              connected={connected}
            />
          </>
        )}

        {step === 5 && (
          <Step5PreviewExport sessionId={sessionId || ''} />
        )}

        {/* Auto-advance to step 5 when complete */}
        {step === 4 && isComplete && (
          <div className="mt-4">
            <button
              onClick={() => { clearEvents(); setStep(5) }}
              className="rounded-md bg-primary px-6 py-2 text-primary-foreground hover:bg-primary/90"
            >
              查看视频 →
            </button>
          </div>
        )}

      </div>

      {/* Col 4: AI Chat Panel */}
      <AIChatPanel
        step={step}
        sessionId={sessionId}
        contextHint={
          step === 2 ? `${characters.length}角色 · ${scenes.length}场景 · ${story ? '故事已生成' : '规划中'}`
          : step === 3 ? `场景${currentScene + 1}/${Object.keys(allShots).length} · ${allShots[currentScene]?.length || 0}镜头`
          : step === 4 ? `生成中 · WS${connected ? '✓' : '?'}`
          : ''
        }
      />
    </div>
  )
}
