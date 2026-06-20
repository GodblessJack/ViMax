import { useState, useMemo, useCallback } from 'react'
import type { PipelineEvent } from '@/lib/types'
import { cn } from '@/lib/utils'
import { CheckCircle, Loader2, AlertCircle, Maximize2, ImageOff } from 'lucide-react'
import { ImageLightbox } from '@/components/ui/ImageLightbox'

type Step4Props = {
  sessionId: string
  events: PipelineEvent[]
  connected: boolean
  connectionState?: string
  sceneCount?: number
  totalShots?: number
  onCancel?: () => void
  cancelled?: boolean
}

export default function Step4Generation({ events, connected, connectionState, totalShots, onCancel, cancelled }: Step4Props) {
  const renderEvents = events.filter(e => e.type === 'render_progress')
  const statusEvents = events.filter(e => e.type === 'pipeline_status')
  const completeEvent = events.find(e => e.type === 'pipeline_complete')
  const errorEvents = events.filter(e => e.type === 'pipeline_error')

  const donePortraits = renderEvents.filter(e => e.stage === 'character_portrait' && e.phase === 'done')

  // Build per-shot status from render_progress events
  const shotStatuses = useMemo(() => {
    if (!totalShots) return null
    const map = new Map<string, 'done' | 'error'>()
    renderEvents.forEach(e => {
      if (e.stage === 'video' && e.phase === 'done') {
        const key = e.metadata?.shot_id || ''
        if (key) map.set(String(key), 'done')
      }
      if (e.stage === 'video' && e.phase === 'error') {
        const key = e.metadata?.shot_id || ''
        if (key) map.set(String(key), 'error')
      }
    })
    const doneCount = Array.from(map.values()).filter(v => v === 'done').length
    return { map, doneCount }
  }, [renderEvents, totalShots])

  // Lightbox for portraits
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set())
  const markBroken = useCallback((url: string) => {
    setBrokenImages(prev => new Set(prev).add(url))
  }, [])
  const portraitImages = donePortraits.map(e => ({
    src: e.image_url || '',
    alt: String(e.metadata?.character || ''),
  }))

  return (
    <div className="page-enter">
      <h2 className="text-xl font-bold mb-1">正在生成视频</h2>
      <p className="text-sm text-muted-foreground mb-6">
        AI 正在渲染角色形象、场景画面和视频片段
      </p>

      {/* Pipeline errors */}
      {errorEvents.length > 0 && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold mb-1">生成出错</p>
              {errorEvents.map((e, i) => (
                <p key={i} className="text-xs mt-0.5 whitespace-pre-wrap">{e.error}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Connection status */}
      <div className="flex items-center gap-2 mb-5 text-xs text-muted-foreground">
        <span className={cn(
          'h-2 w-2 rounded-full',
          connectionState === 'connected' ? 'bg-success animate-pulse' :
          connectionState === 'reconnecting' ? 'bg-warning animate-pulse' :
          connectionState === 'connecting' ? 'bg-warning' : 'bg-destructive',
        )} />
        {connectionState === 'connected' ? 'WebSocket 已连接' :
         connectionState === 'reconnecting' ? '连接断开，重连中...' :
         connectionState === 'connecting' ? '正在连接...' : '连接失败'}
      </div>

      {/* Current status */}
      {statusEvents.length > 0 && (
        <div className="mb-5 rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 text-primary animate-spin" />
            <p className="text-sm font-medium">
              {statusEvents[statusEvents.length - 1]?.stage}
            </p>
            {statusEvents[statusEvents.length - 1]?.message && (
              <span className="text-xs text-muted-foreground">
                : {statusEvents[statusEvents.length - 1]?.message}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Character portraits gallery */}
      {donePortraits.length > 0 && (
        <div className="mb-5">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
            <span>🎨</span> 角色肖像
            <span className="text-xs text-muted-foreground font-normal">
              ({donePortraits.length} 个完成)
            </span>
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {donePortraits.map((e, i) => (
              <div key={i} className="rounded-xl border overflow-hidden bg-card group relative">
                {e.image_url && !brokenImages.has(e.image_url) ? (
                  <div className="relative cursor-pointer" onClick={() => setLightboxIndex(i)}>
                    <img
                      src={e.image_url} alt=""
                      className="w-full aspect-square object-cover"
                      onError={() => markBroken(e.image_url!)}
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <Maximize2 className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                ) : e.image_url && brokenImages.has(e.image_url) ? (
                  <div className="w-full aspect-square flex items-center justify-center bg-muted">
                    <ImageOff className="h-8 w-8 text-muted-foreground/40" />
                  </div>
                ) : (
                  <div className="w-full aspect-square bg-muted flex items-center justify-center">
                    <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
                  </div>
                )}
                <p className="text-xs p-2 truncate text-center font-medium">
                  {String(e.metadata?.character || '')}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Video shot progress grid */}
      {totalShots != null && totalShots > 0 && (
        <div className="mb-5">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
            <span>🎬</span> 视频片段
            <span className="text-xs text-muted-foreground font-normal">
              {shotStatuses ? `${shotStatuses.doneCount} / ${totalShots}` : `0 / ${totalShots}`}
            </span>
          </h3>
          <div className="grid grid-cols-6 gap-1.5">
            {Array.from({ length: totalShots }).map((_, i) => {
              const status = shotStatuses?.map.get(String(i)) || null
              const isCurrent = !status && shotStatuses && i === shotStatuses.doneCount
              return (
                <div
                  key={i}
                  className={cn(
                    'aspect-square rounded-lg flex items-center justify-center text-[10px] font-mono transition-all',
                    status === 'done' && 'bg-success/10 border border-success/30 text-success',
                    status === 'error' && 'bg-destructive/10 border border-destructive/30 text-destructive',
                    isCurrent && 'bg-primary/10 border border-primary/30 text-primary animate-pulse',
                    !status && !isCurrent && 'bg-muted/30 border border-border text-muted-foreground',
                  )}
                  title={`镜头 #${i + 1}${status === 'done' ? ' ✓' : status === 'error' ? ' ✗' : ''}`}
                >
                  {status === 'done' ? '✓' :
                   status === 'error' ? '✗' :
                   isCurrent ? <Loader2 className="h-3 w-3 animate-spin" /> :
                   i + 1}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Generation log */}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground transition-colors font-medium">
          📋 生成日志 ({events.length} 条)
        </summary>
        <div className="mt-2 max-h-40 overflow-y-auto space-y-0.5 rounded-lg bg-muted/50 p-2 font-mono">
          {events.map((e, i) => (
            <div key={i} className={cn(
              'text-[11px] leading-relaxed',
              e.type === 'pipeline_error' && 'text-destructive',
              e.type === 'pipeline_complete' && 'text-success font-semibold',
            )}>
              [{e.type}] {e.stage} {e.phase || ''} {e.message || ''}
            </div>
          ))}
        </div>
      </details>

      {completeEvent && (
        <div className="mt-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800 flex items-center gap-3">
          <CheckCircle className="h-5 w-5 shrink-0" />
          <span className="font-semibold">视频生成完成！</span>
        </div>
      )}

      {/* Cancel button — always visible during generation */}
      {!completeEvent && onCancel && !cancelled && (
        <div className="mt-5 text-center">
          <button
            onClick={onCancel}
            className="text-sm text-muted-foreground hover:text-destructive transition-colors underline underline-offset-4"
          >
            取消生成
          </button>
        </div>
      )}

      {cancelled && (
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="font-semibold">生成已取消。已完成的产物保留。</span>
        </div>
      )}

      {/* Lightbox for character portraits */}
      {lightboxIndex !== null && portraitImages.length > 0 && (
        <ImageLightbox
          images={portraitImages}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onPrev={() => setLightboxIndex(i => Math.max(0, i - 1))}
          onNext={() => setLightboxIndex(i => Math.min(portraitImages.length - 1, i + 1))}
        />
      )}
    </div>
  )
}
