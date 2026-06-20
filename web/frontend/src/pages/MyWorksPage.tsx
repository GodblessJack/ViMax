import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Play, Download, Trash2, Edit3 } from 'lucide-react'
import { listWorks, deleteSession, getFileUrl, getWorkDownloadUrl } from '@/lib/api'
import type { WorkItem } from '@/lib/types'
import { ListRowSkeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { Tooltip } from '@/components/ui/Tooltip'
import { timeAgo } from '@/lib/utils'

export default function MyWorksPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [works, setWorks] = useState<WorkItem[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const res = await listWorks({ search: search || undefined, limit: 50 })
        setWorks(res.items)
        setTotal(res.total)
      } catch { /* API not ready */ }
      finally { setLoading(false) }
    }
    load()
  }, [search])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    try {
      await deleteSession(deleteTarget)
      setWorks(prev => prev.filter(w => w.session_id !== deleteTarget))
      setTotal(prev => prev - 1)
      toast('success', '作品已删除')
    } catch {
      toast('error', '删除失败，请重试')
    } finally {
      setDeleteTarget(null)
    }
  }, [deleteTarget, toast])

  return (
    <div className="p-6 max-w-5xl mx-auto page-enter">
      <h1 className="text-2xl font-bold mb-6">我的作品</h1>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="搜索作品名称..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-xl border pl-10 pr-4 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-all"
        />
      </div>

      {/* Loading */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <ListRowSkeleton key={i} />)}
        </div>
      ) : works.length === 0 ? (
        <EmptyState
          title="暂无作品"
          description={search ? '没有匹配的作品，试试其他关键词' : '还没有创建任何短剧'}
          action={
            !search ? (
              <button
                onClick={() => navigate('/create')}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-[#E84A4F] transition-colors"
              >
                创建第一个短剧
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-2">
          {works.map(w => (
            <div
              key={w.session_id}
              className="flex items-center gap-4 rounded-xl border bg-card p-3 hover:shadow-sm transition-all group"
            >
              {/* Thumbnail */}
              <div
                className="h-16 w-28 shrink-0 rounded-lg bg-muted flex items-center justify-center overflow-hidden cursor-pointer relative"
                onClick={() => navigate(`/works/${w.session_id}`)}
              >
                {w.thumbnail_url ? (
                  <img
                    src={getFileUrl(w.session_id, w.thumbnail_url.replace('/api/files/' + w.session_id + '/', ''))}
                    alt=""
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <Play className="h-6 w-6 text-muted-foreground/50" />
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{w.idea?.slice(0, 50) || '未命名'}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {w.style && <span>{w.style} · </span>}
                  {w.created_at ? timeAgo(w.created_at) : ''}
                  {w.shot_count > 0 && <span> · {w.shot_count} 个镜头</span>}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-0.5 shrink-0">
                <Tooltip content="继续编辑">
                  <button
                    onClick={() => navigate(`/create?session=${w.session_id}`)}
                    className="rounded-lg p-2 text-muted-foreground hover:text-primary hover:bg-primary-light transition-colors"
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>
                </Tooltip>
                <Tooltip content="查看详情">
                  <button
                    onClick={() => navigate(`/works/${w.session_id}`)}
                    className="rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <Play className="h-4 w-4" />
                  </button>
                </Tooltip>
                <Tooltip content="下载视频">
                  <a
                    href={getWorkDownloadUrl(w.session_id)}
                    className="rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                </Tooltip>
                <Tooltip content="删除作品">
                  <button
                    onClick={() => setDeleteTarget(w.session_id)}
                    className="rounded-lg p-2 text-muted-foreground hover:text-destructive hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-4">共 {total} 个作品</p>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        variant="danger"
        title="删除作品"
        message="删除后无法恢复，确定要删除这个作品吗？"
        confirmLabel="删除"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
