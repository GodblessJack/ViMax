import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Play, Download, Trash2 } from 'lucide-react'
import { listWorks, deleteSession, getWorkDownloadUrl } from '@/lib/api'
import type { WorkItem } from '@/lib/types'

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    timerRef.current = setTimeout(() => setDebounced(value), delay)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [value, delay])

  return debounced
}

export default function MyWorksPage() {
  const navigate = useNavigate()
  const [works, setWorks] = useState<WorkItem[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const debouncedSearch = useDebounce(search, 300)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const res = await listWorks({ search: debouncedSearch, limit: 50 })
        if (!cancelled) {
          setWorks(res.items)
          setTotal(res.total)
        }
      } catch {
        if (!cancelled) setError('无法加载作品列表，请确保后端服务已启动')
      }
      finally { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [debouncedSearch])

  async function handleDelete(sessionId: string) {
    if (!confirm('确定要删除这个作品吗？')) return
    try {
      await deleteSession(sessionId)
      setWorks(prev => prev.filter(w => w.session_id !== sessionId))
      setTotal(prev => prev - 1)
    } catch { /* handle */ }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">我的作品</h1>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="搜索作品..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-md border pl-10 pr-4 py-2 text-sm bg-background"
        />
      </div>

      {loading ? (
        <div className="text-center text-muted-foreground py-12">加载中...</div>
      ) : error ? (
        <div className="text-center py-12 border rounded-lg border-red-200 bg-red-50">
          <p className="text-red-600 text-sm mb-2">{error}</p>
          <button onClick={() => window.location.reload()} className="text-xs text-red-500 underline hover:no-underline">
            刷新页面
          </button>
        </div>
      ) : works.length === 0 ? (
        <div className="text-center py-12 border rounded-lg">
          <p className="text-muted-foreground mb-2">暂无作品</p>
          <button onClick={() => navigate('/create')} className="text-primary hover:underline text-sm">
            去创建一个 →
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {works.map(w => (
            <div
              key={w.session_id}
              className="flex items-center gap-4 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
            >
              {/* Thumbnail */}
              <div
                className="h-16 w-28 shrink-0 rounded bg-muted flex items-center justify-center overflow-hidden cursor-pointer"
                onClick={() => navigate(`/works/${w.session_id}`)}
              >
                {w.thumbnail_url ? (
                  <img src={w.thumbnail_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Play className="h-6 w-6 text-muted-foreground" />
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{w.idea?.slice(0, 40) || '未命名'}</p>
                <p className="text-xs text-muted-foreground">
                  {w.style} · {w.shot_count > 0 ? `${w.shot_count}镜头 · ` : ''}{w.created_at?.slice(0, 10)}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => navigate(`/works/${w.session_id}`)}
                  className="rounded p-2 text-muted-foreground hover:text-foreground hover:bg-accent"
                  title="查看"
                >
                  <Play className="h-4 w-4" />
                </button>
                <a
                  href={getWorkDownloadUrl(w.session_id)}
                  className="rounded p-2 text-muted-foreground hover:text-foreground hover:bg-accent"
                  title="下载"
                >
                  <Download className="h-4 w-4" />
                </a>
                <button
                  onClick={() => handleDelete(w.session_id)}
                  className="rounded p-2 text-muted-foreground hover:text-destructive hover:bg-accent"
                  title="删除"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-4">共 {total} 个作品</p>
    </div>
  )
}
