import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download } from 'lucide-react'
import { getSession, getWorkDownloadUrl } from '@/lib/api'
import type { SessionDetail } from '@/lib/types'

export default function WorkDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const [session, setSession] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!sessionId) return
    const sid: string = sessionId  // narrow type for closure
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const detail = await getSession(sid)
        if (!cancelled) setSession(detail)
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : '加载失败，请检查后端服务'
          setError(msg)
        }
      }
      finally { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [sessionId])

  if (loading) return <div className="p-6 text-muted-foreground">加载中...</div>
  if (error) return (
    <div className="p-6 max-w-4xl mx-auto text-center">
      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
        <p className="text-red-600 mb-2">{error}</p>
        <button onClick={() => navigate('/works')} className="text-sm text-primary hover:underline">
          ← 返回作品列表
        </button>
      </div>
    </div>
  )
  if (!session || !sessionId) return <div className="p-6 text-muted-foreground">作品未找到</div>

  // Use dedicated endpoint with automatic fallback (scene_0, script2video)
  const videoUrl = session.has_final_video
    ? `/api/files/${sessionId}/final_video`
    : null

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button
        onClick={() => navigate('/works')}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> 返回作品列表
      </button>

      <h1 className="text-xl font-bold mb-4">{session.idea || '未命名'}</h1>

      {/* Video Player */}
      <div className="mb-6 rounded-lg overflow-hidden bg-black">
        {videoUrl ? (
          <video controls className="w-full max-h-[500px]" src={videoUrl}>
            Your browser does not support video playback.
          </video>
        ) : (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            视频尚未生成
          </div>
        )}
      </div>

      {/* Info */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">风格</p>
          <p className="font-medium">{session.style || '—'}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">状态</p>
          <p className="font-medium">{session.stage}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">用户需求</p>
          <p className="font-medium text-sm">{session.user_requirement || '—'}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">镜头数</p>
          <p className="font-medium">{session.shot_count || '—'}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">创建时间</p>
          <p className="font-medium">{session.created_at}</p>
        </div>
      </div>

      {/* Download */}
      {session.has_final_video && sessionId && (
        <a
          href={getWorkDownloadUrl(sessionId)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Download className="h-4 w-4" />
          下载视频
        </a>
      )}
    </div>
  )
}
