import type { SceneScript } from '@/stores/types'

// ScriptResultPanel — scene/dialogue list
export function ScriptResultPanel({
  data,
  onEdit,
}: {
  data: unknown
  onEdit?: (path: string, value: unknown) => void
}) {
  const scenes = (Array.isArray(data) ? data : []) as SceneScript[]

  return (
    <div className="script-result space-y-4">
      <h3 className="font-semibold text-lg">
        📜 剧本场景 ({scenes.length})
      </h3>
      {scenes.length === 0 ? (
        <p className="text-muted-foreground text-sm">暂无剧本数据</p>
      ) : (
        <div className="space-y-2">
          {scenes.map((scene, i) => (
            <div
              key={i}
              className="border rounded-lg p-3 bg-card flex items-center gap-3"
            >
              <span className="text-sm font-mono text-muted-foreground">
                #{scene.index}
              </span>
              <div>
                <p className="font-medium">{scene.title}</p>
                <p className="text-xs text-muted-foreground">
                  {scene.shot_count} 个镜头
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
