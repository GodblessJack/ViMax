import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Play, Clock, Sparkles, ArrowRight, Trash2 } from 'lucide-react'
import { listSessions, listWorks, deleteSession, getFileUrl } from '@/lib/api'
import type { SessionSummary, WorkItem } from '@/lib/types'
import { DashboardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { timeAgo } from '@/lib/utils'

export default function DashboardPage() {
  const navigate = useNavigate()
  const [recentWorks, setRecentWorks] = useState<WorkItem[]>([])
  const [activeSessions, setActiveSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const { toast } = useToast()

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    try {
      await deleteSession(deleteTarget)
      setActiveSessions(prev => prev.filter(s => s.session_id !== deleteTarget))
      setRecentWorks(prev => prev.filter(w => w.session_id !== deleteTarget))
      toast('success', '会话已删除')
    } catch {
      toast('error', '删除失败')
    } finally {
      setDeleteTarget(null)
    }
  }, [deleteTarget, toast])

  useEffect(() => {
    async function load() {
      try {
        const [works, sessions] = await Promise.all([
          listWorks({ limit: 8 }),
          listSessions({ limit: 10 }),
        ])
        setRecentWorks(works.items)
        const active = sessions.items.filter(
          s => s.stage === 'rendering' || s.stage === 'narrative_planning' || s.stage === 'narrative_planned',
        )
        setActiveSessions(active)
      } catch {
        // API not ready yet
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <DashboardSkeleton />

  return (
    <div className="p-6 max-w-5xl mx-auto page-enter">
      {/* Hero Create Section */}
      <div className="mb-10 rounded-2xl border bg-card p-10 text-center relative overflow-hidden">
        {/* Subtle gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.03] via-transparent to-amber-50/50 pointer-events-none" />

        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary-light px-3 py-1 text-xs font-medium text-primary mb-4">
            <Sparkles className="h-3.5 w-3.5" />
            AI 创作
          </div>

          <h1 className="text-3xl font-bold mb-2 tracking-tight">
            创作你的<span className="text-primary">短剧</span>
          </h1>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            输入创意想法，AI 自动完成故事编写、角色设计、分镜生成和视频渲染
          </p>

          <button
            onClick={() => navigate('/create')}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-primary-foreground hover:bg-[#E84A4F] transition-all duration-200 font-semibold shadow-sm hover:shadow-md active:scale-[0.98]"
          >
            <Plus className="h-5 w-5" />
            开始创建
          </button>
        </div>
      </div>

      {/* Active Sessions */}
      {activeSessions.length > 0 && (
        <div className="mb-10">
          <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
            </span>
            进行中 ({activeSessions.length})
          </h2>
          <div className="space-y-2">
            {activeSessions.map(s => {
              const progress = s.stage === 'narrative_planned'
                ? 40
                : s.stage === 'rendering' ? 65 : 15
              return (
                <div
                  key={s.session_id}
                  className="flex items-center gap-4 rounded-xl border bg-card p-4 hover:shadow-sm transition-all cursor-pointer group"
                  onClick={() => navigate(`/create?session=${s.session_id}`)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">
                      {s.idea?.slice(0, 40) || '未命名'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.stage === 'narrative_planning' && 'AI 规划中'}
                      {s.stage === 'narrative_planned' && '等待生成'}
                      {s.stage === 'rendering' && '视频生成中'}
                      {s.created_at && <> · {timeAgo(s.created_at)}</>}
                    </p>
                  </div>

                  {/* Actual progress bar */}
                  <div className="w-24 shrink-0 hidden sm:block">
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-700 ease-in-out"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  <span className="text-sm text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity shrink-0 hidden sm:inline">
                    继续 <ArrowRight className="inline h-3.5 w-3.5" />
                  </span>

                  {/* Delete */}
                  <button
                    onClick={e => { e.stopPropagation(); setDeleteTarget(s.session_id) }}
                    className="rounded-lg p-1.5 text-muted-foreground/40 hover:text-destructive hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                    title="删除"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Recent Works */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Clock className="h-5 w-5" />
            最近作品
          </h2>
          {recentWorks.length > 0 && (
            <button
              onClick={() => navigate('/works')}
              className="text-sm text-primary font-medium hover:underline"
            >
              查看全部 →
            </button>
          )}
        </div>

        {recentWorks.length === 0 ? (
          <EmptyState
            title="还没有作品"
            description="创建你的第一个 AI 短剧，只需输入创意即可开始"
            action={
              <button
                onClick={() => navigate('/create')}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-[#E84A4F] transition-colors"
              >
                <Plus className="h-4 w-4" />
                创建短剧
              </button>
            }
          />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {recentWorks.map(w => (
              <div
                key={w.session_id}
                className="group rounded-xl border bg-card overflow-hidden hover:shadow-md transition-all duration-200 cursor-pointer active:scale-[0.98]"
                onClick={() => navigate(`/works/${w.session_id}`)}
              >
                {/* Thumbnail */}
                <div className="aspect-video bg-muted flex items-center justify-center relative overflow-hidden">
                  {w.thumbnail_url ? (
                    <img
                      src={getFileUrl(w.session_id, w.thumbnail_url.replace('/api/files/' + w.session_id + '/', ''))}
                      alt=""
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground/60">
                      <Play className="h-8 w-8" />
                      <span className="text-xs">暂无预览</span>
                    </div>
                  )}
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                    <Play className="h-10 w-10 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                  </div>
                </div>

                {/* Info */}
                <div className="p-3">
                  <p className="text-sm font-medium truncate">
                    {w.idea?.slice(0, 20) || '未命名'}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">
                      {w.created_at ? timeAgo(w.created_at) : ''}
                    </span>
                    {w.style && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground truncate">
                        {w.style}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        variant="danger"
        title="删除会话"
        message="删除后无法恢复，确定要删除这个会话吗？"
        confirmLabel="删除"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
