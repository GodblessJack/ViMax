import { useState, useCallback, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import StepIndicator from '@/components/wizard/StepIndicator'
import Step1IdeaInput from '@/components/wizard/Step1IdeaInput'
import Step2PlanningReview from '@/components/wizard/Step2PlanningReview'
import Step3StoryboardReview from '@/components/wizard/Step3StoryboardReview'
import Step4Generation from '@/components/wizard/Step4Generation'
import Step5PreviewExport from '@/components/wizard/Step5PreviewExport'
import AIChatPanel from '@/components/layout/AIChatPanel'
import { usePipelineWebSocket } from '@/hooks/useWebSocket'
import { useDraft } from '@/hooks/useDraft'
import { cn } from '@/lib/utils'
import { startPlanning, startRendering, getSession, cancelPipeline } from '@/lib/api'
import type { WizardStep, ShotInfo } from '@/lib/types'

// ── Pipeline Progress Sidebar ─────────────────────────────────────

const PIPELINE_STEPS = [
  { s: 1, label: '创意沟通' },
  { s: 2, label: 'AI 规划' },
  { s: 3, label: '确认分镜' },
  { s: 4, label: '视频生成' },
  { s: 5, label: '预览导出' },
]

function PipelinePanel({ step, sessionId }: { step: WizardStep; sessionId: string | null }) {
  return (
    <aside className="w-[180px] border-r bg-sidebar p-3 flex-shrink-0 overflow-y-auto">
      <h3 className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
        进度
      </h3>
      <div className="space-y-0.5">
        {PIPELINE_STEPS.map(item => (
          <div
            key={item.s}
            className={cn(
              'flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors',
              step === item.s && 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground',
              step > item.s && 'text-primary',
              step < item.s && 'text-muted-foreground',
            )}
          >
            <span className={cn(
              'flex h-5 w-5 items-center justify-center rounded-full text-[10px] shrink-0',
              step > item.s && 'bg-primary text-primary-foreground',
              step === item.s && 'bg-primary text-primary-foreground',
              step < item.s && 'bg-muted text-muted-foreground',
            )}>
              {step > item.s ? '✓' : item.s}
            </span>
            {item.label}
          </div>
        ))}
      </div>
      {sessionId && (
        <div className="mt-4 pt-3 border-t">
          <p className="text-[10px] text-muted-foreground">会话 ID</p>
          <p className="text-[11px] font-mono truncate text-muted-foreground">
            {sessionId.slice(0, 16)}...
          </p>
        </div>
      )}
    </aside>
  )
}

// ── Main Page ─────────────────────────────────────────────────────

export default function CreateDramaPage() {
  const [step, setStep] = useState<WizardStep>(1)
  const [idea, setIdea] = useState('')
  const [style, setStyle] = useState('')
  const [aiExtractedIdea, setAiExtractedIdea] = useState('')
  const [aiExtractedStyle, setAiExtractedStyle] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [planError, setPlanError] = useState('')

  // Step 2 data
  const [story, setStory] = useState('')
  const [characters, setCharacters] = useState<any[]>([])
  const [scenes, setScenes] = useState<any[]>([])

  // Step 3 data
  const [storyboardScenes, setStoryboardScenes] = useState<{ index: number; title: string; shots: ShotInfo[] }[]>([])
  const [sceneIndex, setSceneIndex] = useState(0)
  const [sceneLoading, setSceneLoading] = useState(false)

  // Step 4 data
  const { events, connected, connectionState, clearEvents } = usePipelineWebSocket(sessionId)

  // Draft auto-save & restore
  const { restore: restoreDraft, clear: clearDraft } = useDraft(idea, style)
  useEffect(() => {
    const draft = restoreDraft()
    if (draft && !idea && step === 1) {
      if (draft.idea) setIdea(draft.idea)
      if (draft.style) setStyle(draft.style)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Polling refs
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  // ── Session restore: ?session=xxx resumes an existing session ─
  const [searchParams] = useSearchParams()
  const restoredRef = useRef(false)

  useEffect(() => {
    const sid = searchParams.get('session')
    if (!sid || restoredRef.current) return
    restoredRef.current = true

    async function restore() {
      try {
        const detail = await getSession(sid)
        if (!mountedRef.current) return

        setSessionId(sid)
        setIdea(detail.idea || '')
        setStyle(detail.style || 'wuxia')

        // Jump to correct step based on session stage
        const stage = detail.stage
        if (stage === 'created') {
          setStep(1)
        } else if (stage === 'narrative_planning') {
          setStep(2)
          setLoading(true)
        } else if (stage === 'narrative_planned') {
          // Fetch artifacts and go to Step 2
          setStep(2)
          setLoading(false)
          if (detail.artifact_checklist?.['idea2video/story.txt']) {
            const r = await fetch(`/api/files/${sid}/idea2video/story.txt`)
            if (mountedRef.current) setStory(r.ok ? await r.text() : '')
          }
          if (detail.artifact_checklist?.['idea2video/characters.json']) {
            const r = await fetch(`/api/files/${sid}/idea2video/characters.json`)
            if (mountedRef.current && r.ok) setCharacters(await r.json())
          }
          if (detail.artifact_checklist?.['idea2video/script.json']) {
            const r = await fetch(`/api/files/${sid}/idea2video/script.json`)
            if (mountedRef.current && r.ok) {
              const arr = await r.json()
              setScenes(arr.map((_: string, i: number) => ({
                index: i, title: `Scene ${i + 1}`, shot_count: 0,
              })))
            }
          }
          if (detail.artifact_checklist?.['idea2video/scene_*/storyboard.json']) {
            const r = await fetch(`/api/files/${sid}/idea2video/scene_0/storyboard.json`)
            if (mountedRef.current && r.ok) {
              const sb = await r.json()
              if (Array.isArray(sb) && sb.length > 0) {
                const mapped = sb.map((s: any) => {
                  return {
                    idx: s.idx ?? 0, cam_idx: s.cam_idx ?? 0,
                    visual_desc: s.visual_desc ?? '', audio_desc: s.audio_desc ?? '',
                    angle: `机位${s.cam_idx ?? 0}`,
                  }
                })
                setStoryboardScenes([{ index: 0, title: scenes[0]?.title || 'Scene 1', shots: mapped }])
                // Update scene 0 shot_count with real data
                setScenes(prev => prev.map((s, i) =>
                  i === 0 ? { ...s, shot_count: sb.length } : s,
                ))
              }
            }
          }
        } else if (stage === 'rendering') {
          setStep(4)
        } else if (stage === 'rendered') {
          setStep(5)
        } else {
          // error, cancelled → show Step 2 with error
          setStep(2)
          setPlanError(detail.summary || `会话状态: ${stage}`)
        }
      } catch {
        // Session not found or API error — stay on Step 1
      }
    }
    restore()
  }, [searchParams])

  // ── Step 1 → Step 2: Trigger planning with polling ────────────
  const handleStartPlanning = useCallback(async () => {
    if (!idea.trim()) return
    clearDraft()
    setCancelled(false)
    setLoading(true)
    setStep(2)
    setPlanError('')
    setStory('')
    setCharacters([])
    setScenes([])
    setStoryboardScenes([])

    try {
      const effectiveStyle = style || 'wuxia'
      const resp = await startPlanning({ idea, user_requirement: '', style: effectiveStyle })
      setSessionId(resp.session_id)
      const sid = resp.session_id

      pollRef.current = setInterval(async () => {
        try {
          const detail = await getSession(sid)
          if (!mountedRef.current) return

          if (detail.stage === 'narrative_planned') {
            clearInterval(pollRef.current!)
            if (!mountedRef.current) return
            setLoading(false)

            // Fetch story
            if (detail.artifact_checklist?.['idea2video/story.txt']) {
              const r = await fetch(`/api/files/${sid}/idea2video/story.txt`)
              if (mountedRef.current) setStory(r.ok ? await r.text() : '')
            }
            // Fetch characters
            if (detail.artifact_checklist?.['idea2video/characters.json']) {
              const r = await fetch(`/api/files/${sid}/idea2video/characters.json`)
              if (mountedRef.current && r.ok) setCharacters(await r.json())
            }
            // Fetch script
            if (detail.artifact_checklist?.['idea2video/script.json']) {
              const r = await fetch(`/api/files/${sid}/idea2video/script.json`)
              if (mountedRef.current && r.ok) {
                const arr = await r.json()
                setScenes(arr.map((_: string, i: number) => ({
                  index: i, title: `Scene ${i + 1}`, shot_count: 0,
                })))
              }
            }
            // Fetch storyboard
            if (detail.artifact_checklist?.['idea2video/scene_*/storyboard.json']) {
              const r = await fetch(`/api/files/${sid}/idea2video/scene_0/storyboard.json`)
              if (mountedRef.current && r.ok) {
                const sb = await r.json()
                if (Array.isArray(sb) && sb.length > 0) {
                  const mapped2 = sb.map((s: any) => { return {
                    idx: s.idx ?? 0, cam_idx: s.cam_idx ?? 0,
                    visual_desc: s.visual_desc ?? '', audio_desc: s.audio_desc ?? '',
                    angle: `机位${s.cam_idx ?? 0}`,
                  }})
                  setStoryboardScenes([{ index: 0, title: scenes[0]?.title || 'Scene 1', shots: mapped2 }])
                  setScenes(prev => prev.map((s, i) =>
                    i === 0 ? { ...s, shot_count: sb.length } : s,
                  ))
                }
              }
            }
          } else if (detail.stage === 'error') {
            clearInterval(pollRef.current!)
            if (mountedRef.current) {
              setLoading(false)
              setPlanError(detail.summary || 'Planning failed')
            }
          }
        } catch { /* keep polling */ }
      }, 2000)
    } catch (err: any) {
      if (mountedRef.current) {
        setLoading(false)
        setPlanError(err?.message || String(err))
      }
    }
  }, [idea, style])

  // ── Cancel planning (Step 2) ──────────────────────────────────
  const handleCancelPlanning = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    setLoading(false)
    setStep(1)
    setPlanError('')
  }, [])

  // ── Cancel rendering (Step 4) ─────────────────────────────────
  const [cancelled, setCancelled] = useState(false)
  const handleCancelRendering = useCallback(async () => {
    if (!sessionId) return
    try { await cancelPipeline(sessionId) } catch { /* best effort */ }
    setCancelled(true)
    setLoading(false)
  }, [sessionId])

  // ── Step 3 → Step 4: Trigger rendering ──────────────────────
  const handleStartRendering = useCallback(async () => {
    if (!sessionId) return
    setCancelled(false)
    setLoading(true)
    setStep(4)
    try {
      await startRendering({ session_id: sessionId })
    } catch (err) {
      console.error('Rendering failed:', err)
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  const isComplete = events.some(e => e.type === 'pipeline_complete')

  const handleStepClick = useCallback((s: WizardStep) => {
    // Only allow going back to completed steps
    if (s < step && s !== 4) {
      setStep(s)
    }
    // Allow going to Step 5 only if complete
    if (s === 5 && isComplete) {
      setStep(5)
    }
  }, [step, isComplete])

  return (
    <div className="flex h-full">
      {/* Col 2: Pipeline Progress */}
      <PipelinePanel step={step} sessionId={sessionId} />

      {/* Col 3: Main Workspace — shows artifacts, AI drives the flow */}
      <div className="flex-1 p-6 overflow-y-auto">
        <StepIndicator current={step} onStepClick={handleStepClick} />

        {step === 1 && (
          <Step1IdeaInput
            idea={idea} setIdea={setIdea}
            style={style} setStyle={setStyle}
            loading={loading} onNext={handleStartPlanning}
            aiIdea={aiExtractedIdea || undefined}
            aiStyle={aiExtractedStyle || undefined}
          />
        )}

        {step === 2 && (
          <Step2PlanningReview
            story={story} setStory={setStory}
            characters={characters} scenes={scenes}
            loading={loading} error={planError}
            onRegenerate={handleStartPlanning}
            onConfirm={() => storyboardScenes.length > 0 ? setStep(3) : handleStartRendering()}
            onCancel={handleCancelPlanning}
          />
        )}

        {step === 3 && (
          <Step3StoryboardReview
            scenes={storyboardScenes} sceneIndex={sceneIndex} sceneLoading={sceneLoading}
            onSceneChange={async (i) => {
              setSceneIndex(i)
              if (!storyboardScenes.find(s => s.index === i) && sessionId) {
                setSceneLoading(true)
                try {
                  const r = await fetch(`/api/files/${sessionId}/idea2video/scene_${i}/storyboard.json`)
                  if (r.ok) {
                    const sb = await r.json()
                    if (Array.isArray(sb) && sb.length > 0) {
                      const mapped = sb.map((s: any) => ({
                        idx: s.idx ?? 0, cam_idx: s.cam_idx ?? 0,
                        visual_desc: s.visual_desc ?? '', audio_desc: s.audio_desc ?? '',
                        angle: `机位${s.cam_idx ?? 0}`,
                      }))
                      setStoryboardScenes(prev => {
                        const exists = prev.find(s => s.index === i)
                        if (exists) return prev.map(s => s.index === i ? { ...s, shots: mapped } : s)
                        return [...prev, { index: i, title: scenes[i]?.title || `Scene ${i + 1}`, shots: mapped }]
                      })
                    }
                  }
                } finally {
                  setSceneLoading(false)
                }
              }
            }}
            onBack={() => setStep(2)} onConfirm={handleStartRendering}
          />
        )}

        {step === 4 && (
          <Step4Generation
            sessionId={sessionId || ''} events={events} connected={connected} connectionState={connectionState}
            totalShots={scenes.reduce((sum, s) => sum + (s.shot_count || 0), 0) || undefined}
            onCancel={handleCancelRendering} cancelled={cancelled}
          />
        )}

        {step === 5 && (
          <Step5PreviewExport sessionId={sessionId || ''} />
        )}

        {step === 4 && isComplete && (
          <div className="mt-4">
            <button
              onClick={() => { clearEvents(); setStep(5) }}
              className="rounded-xl bg-primary px-6 py-2.5 text-primary-foreground hover:bg-[#E84A4F] font-semibold transition-all shadow-sm"
            >
              查看视频 →
            </button>
          </div>
        )}
      </div>

      {/* Col 4: AI Chat Panel — core interaction hub, always visible, no collapse */}
      <AIChatPanel
        step={step}
        sessionId={sessionId}
        idea={idea}
        style={style}
        storyChars={story.length || undefined}
        characterCount={characters.length || undefined}
        sceneCount={scenes.length || undefined}
        totalShots={scenes.reduce((sum, s) => sum + (s.shot_count || 0), 0) || undefined}
        onIdeaExtracted={(v) => { setIdea(v); setAiExtractedIdea(v) }}
        onStyleExtracted={(v) => { setStyle(v); setAiExtractedStyle(v) }}
        onStartPlanning={handleStartPlanning}
      />
    </div>
  )
}
