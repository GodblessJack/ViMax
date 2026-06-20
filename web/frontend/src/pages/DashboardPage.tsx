import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Play, Clock } from 'lucide-react'
import { listSessions, listWorks } from '@/lib/api'
import type { SessionSummary, WorkItem } from '@/lib/types'

export default function DashboardPage() {
  const navigate = useNavigate()
  const [recentWorks, setRecentWorks] = useState<WorkItem[]>([])
  const [activeSessions, setActiveSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const [works, sessions] = await Promise.all([
          listWorks({ limit: 8 }),
          listSessions({ limit: 3 }),
        ])
        setRecentWorks(works.items)
        // Show sessions that are actively being worked on (not finished/error)
        setActiveSessions(sessions.items.filter(
          s => s.stage !== 'rendered' && s.stage !== 'error' && s.stage !== 'cancelled',
        ))
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '无法加载数据，请确保后端服务已启动'
        setError(msg)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Hero Create Section */}
      <div className="mb-8 rounded-xl border bg-card p-8 text-center">
        <h1 className="text-2xl font-bold mb-2">🎬 创建短剧</h1>
        <p className="text-muted-foreground mb-4">输入想法，AI 自动生成专业短视频</p>
        <button
          onClick={() => navigate('/create')}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
        >
          <Plus className="h-5 w-5" />
          开始创建
        </button>
      </div>

      {/* Active Sessions */}
      {activeSessions.length > 0 && (
        <div className="mb-8">
          <h2 className="flex items-center gap-2 text-lg font-semibold mb-3">
            <Play className="h-5 w-5 text-blue-500" /> 进行中
          </h2>
          <div className="space-y-2">
            {activeSessions.map(s => (
              <div key={s.session_id} className="flex items-center gap-3 rounded-lg border p-3">
                <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
                  <div className="h-full w-1/2 rounded-full bg-blue-500 animate-pulse" />
                </div>
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  {s.idea?.slice(0, 30) || '未命名'}...
                </span>
                <button
                  onClick={() => navigate(`/works/${s.session_id}`)}
                  className="text-sm text-primary hover:underline whitespace-nowrap"
                >
                  查看
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Works */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Clock className="h-5 w-5" /> 最近作品
          </h2>
          <button onClick={() => navigate('/works')} className="text-sm text-primary hover:underline">
            查看全部 →
          </button>
        </div>
        {loading ? (
          <div className="text-center text-muted-foreground py-8">加载中...</div>
        ) : error ? (
          <div className="text-center py-8 border rounded-lg border-red-200 bg-red-50">
            <p className="text-red-600 text-sm mb-2">{error}</p>
            <button onClick={() => window.location.reload()} className="text-xs text-red-500 underline hover:no-underline">
              刷新页面
            </button>
          </div>
        ) : recentWorks.length === 0 ? (
          <div className="text-center text-muted-foreground py-8 border rounded-lg">
            还没有作品，<button onClick={() => navigate('/create')} className="text-primary hover:underline">创建第一个</button>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {recentWorks.map(w => (
              <div
                key={w.session_id}
                className="rounded-lg border overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => navigate(`/works/${w.session_id}`)}
              >
                <div className="aspect-video bg-muted flex items-center justify-center">
                  {w.thumbnail_url ? (
                    <img src={w.thumbnail_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Play className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
                <div className="p-2">
                  <p className="text-sm font-medium truncate">{w.idea?.slice(0, 20) || '未命名'}</p>
                  <p className="text-xs text-muted-foreground">{w.created_at?.slice(0, 10)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
