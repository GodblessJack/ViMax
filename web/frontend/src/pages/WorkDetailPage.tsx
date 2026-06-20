import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, Edit3, Calendar, Palette, Info, Play, Film } from 'lucide-react'
import { getSession, getWorkDownloadUrl, getFileUrl } from '@/lib/api'
import type { SessionDetail } from '@/lib/types'
import { Skeleton } from '@/components/ui/Skeleton'
import { ImageLightbox } from '@/components/ui/ImageLightbox'
import { timeAgo } from '@/lib/utils'

export default function WorkDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const [session, setSession] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)

  // Artifact data
  const [story, setStory] = useState('')
  const [characters, setCharacters] = useState<any[]>([])
  const [scenes, setScenes] = useState<any[]>([])

  // Lightbox
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const [videoError, setVideoError] = useState(false)

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    async function load() {
      try {
        const detail = await getSession(sessionId!)
        if (cancelled) return
        setSession(detail)

        // Fetch artifacts
        if (detail.artifact_checklist?.['idea2video/story.txt']) {
          const r = await fetch(getFileUrl(sessionId!, 'idea2video/story.txt'))
          if (!cancelled && r.ok) setStory(await r.text())
        }
        if (detail.artifact_checklist?.['idea2video/characters.json']) {
          const r = await fetch(getFileUrl(sessionId!, 'idea2video/characters.json'))
          if (!cancelled && r.ok) setCharacters(await r.json())
        }
        if (detail.artifact_checklist?.['idea2video/script.json']) {
          const r = await fetch(getFileUrl(sessionId!, 'idea2video/script.json'))
          if (!cancelled && r.ok) {
            const arr = await r.json()
            const sceneList = await Promise.all(
              arr.map(async (_: string, i: number) => {
                let shot_count = 0
                if (cancelled) return { index: i, title: `Scene ${i + 1}`, shot_count: 0 }
                try {
                  const sbUrl = getFileUrl(sessionId!, `idea2video/scene_${i}/storyboard.json`)
                  const sbResp = await fetch(sbUrl)
                  if (sbResp.ok) {
                    const shots = await sbResp.json()
                    shot_count = Array.isArray(shots) ? shots.length : 0
                  }
                } catch { /* storyboard not available */ }
                return { index: i, title: `Scene ${i + 1}`, shot_count }
              })
            )
            if (!cancelled) setScenes(sceneList)
          }
        }
      } catch { /* handle */ }
      finally { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [sessionId])

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto page-enter space-y-6">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="aspect-video w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-20 page-enter">
        <p className="text-muted-foreground text-lg mb-2">作品未找到</p>
        <button onClick={() => navigate('/works')} className="text-primary hover:underline text-sm">返回作品列表</button>
      </div>
    )
  }

  // Use the dedicated /final_video endpoint which has fallback to scene_0
  const videoUrl = session.has_final_video ? `/api/files/${sessionId}/final_video` : null
  const isIncomplete = !session.has_final_video

  // Character images for lightbox
  const characterImages = characters.flatMap((c: any) => {
    const imgs: { src: string; alt: string }[] = []
    const sid = sessionId!
    const charName = c.identifier_in_scene || `角色${c.idx ?? ''}`
    const views = ['front', 'side', 'back']
    views.forEach(view => {
      // Construct character portrait URL pattern
      // Pipeline saves under character_portraits/{idx}_{name}/{view}.png
      const portraitDir = c.idx !== undefined ? `${c.idx}_${charName}` : charName
      const url = getFileUrl(sid, `idea2video/character_portraits/${portraitDir}/${view}.png`)
      imgs.push({ src: url, alt: `${charName} - ${view}` })
    })
    return imgs
  })

  return (
    <div className="p-6 max-w-4xl mx-auto page-enter">
      {/* Back + Continue */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => navigate('/works')}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> 返回作品列表
        </button>
        {isIncomplete && (
          <button
            onClick={() => navigate(`/create?session=${sessionId}`)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:brightness-90 transition-colors"
          >
            <Edit3 className="h-4 w-4" /> 继续编辑
          </button>
        )}
      </div>

      <h1 className="text-2xl font-bold mb-6 tracking-tight">{session.idea || '未命名'}</h1>

      {/* Video Player */}
      <div className="mb-6 rounded-xl overflow-hidden bg-black shadow-lg">
        {videoUrl ? (
          <>
            <video controls className="w-full max-h-[450px]" src={videoUrl}
              poster={session.thumbnail_url ? getFileUrl(sessionId!, session.thumbnail_url.replace('/api/files/' + sessionId + '/', '')) : undefined}
              onError={() => setVideoError(true)}>
              Your browser does not support video playback.
            </video>
            {videoError && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <p className="text-sm">视频加载失败</p>
                <p className="text-xs mt-1 opacity-60">视频文件可能尚未就绪或已被移除</p>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
            {session.stage === 'error'
              ? <><span className="text-3xl">⚠️</span><p>生成过程中出现问题</p></>
              : <><span className="text-3xl">🎬</span><p>视频尚未生成</p><p className="text-xs">状态：{session.stage}</p></>
            }
          </div>
        )}
      </div>

      {/* Info Grid */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Palette className="h-3.5 w-3.5" /> 风格
          </div>
          <p className="font-semibold">{session.style || '—'}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Info className="h-3.5 w-3.5" /> 状态
          </div>
          <p className="font-semibold">
            <span className={`inline-flex items-center gap-1.5 ${session.stage === 'rendered' ? 'text-success' : session.stage === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${session.stage === 'rendered' ? 'bg-success' : session.stage === 'error' ? 'bg-destructive' : 'bg-muted-foreground'}`} />
              {session.stage === 'created' && '已创建'}
              {session.stage === 'narrative_planning' && 'AI 规划中'}
              {session.stage === 'narrative_planned' && '规划完成'}
              {session.stage === 'rendering' && '生成中'}
              {session.stage === 'rendered' && '已完成'}
              {session.stage === 'error' && '失败'}
              {session.stage === 'cancelled' && '已取消'}
            </span>
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4 col-span-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Info className="h-3.5 w-3.5" /> 创作需求
          </div>
          <p className="text-sm">{session.user_requirement || '—'}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Calendar className="h-3.5 w-3.5" /> 创建时间
          </div>
          <p className="font-semibold text-sm">{timeAgo(session.created_at)}</p>
        </div>
      </div>

      {/* Story text */}
      {story && (
        <div className="mb-6 rounded-xl border bg-card p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-3">
            <span>📖</span> 故事
          </h3>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {story.slice(0, 500)}{story.length > 500 && '...'}
          </p>
        </div>
      )}

      {/* Characters */}
      {characters.length > 0 && (
        <div className="mb-6 rounded-xl border bg-card p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-3">
            <span>👥</span> 角色 ({characters.length})
          </h3>
          <div className="flex gap-3 flex-wrap">
            {characters.map((c: any, i: number) => (
              <button
                key={i}
                onClick={() => { setLightboxIndex(i * 3); setLightboxOpen(true) }}
                className="rounded-lg bg-muted px-4 py-2.5 text-sm hover:bg-muted/80 transition-colors cursor-pointer text-left"
                aria-label={`查看 ${c.identifier_in_scene || `角色${c.idx ?? ''}`} 的形象图`}
              >
                <span className="font-semibold">{c.identifier_in_scene || `角色${c.idx ?? ''}`}</span>
                {c.static_features && (
                  <span className="text-muted-foreground ml-2 text-xs">— {c.static_features.slice(0, 40)}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Scene structure */}
      {scenes.length > 0 && (
        <div className="mb-6 rounded-xl border bg-card p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-3">
            <span>📺</span> 分集结构 ({scenes.length} 集)
          </h3>
          <div className="space-y-1">
            {scenes.map((s: any, i: number) => (
              <div key={`scene-${i}`} className="flex items-center justify-between py-2 px-3 rounded-lg text-sm">
                <span className="font-medium">第{s.index + 1}集：{s.title}</span>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  <Film className="h-3 w-3 inline mr-0.5" />
                  {s.shot_count} 镜头
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Download */}
      {session.has_final_video && (
        <a href={getWorkDownloadUrl(sessionId!)}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-primary-foreground hover:brightness-90 transition-all font-medium shadow-sm hover:shadow-md active:scale-[0.98]">
          <Download className="h-4 w-4" /> 下载视频
        </a>
      )}

      {/* Lightbox */}
      {lightboxOpen && (
        <ImageLightbox
          images={characterImages}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxOpen(false)}
          onPrev={() => setLightboxIndex(i => Math.max(0, i - 1))}
          onNext={() => setLightboxIndex(i => Math.min(characterImages.length - 1, i + 1))}
        />
      )}
    </div>
  )
}
