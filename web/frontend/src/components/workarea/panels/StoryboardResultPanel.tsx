import type { StoryboardScene } from '@/stores/types'

// StoryboardResultPanel — storyboard shot grid
export function StoryboardResultPanel({
  data,
  onEdit,
}: {
  data: unknown
  onEdit?: (path: string, value: unknown) => void
}) {
  const scenes = (Array.isArray(data) ? data : []) as StoryboardScene[]

  return (
    <div className="storyboard-result space-y-4">
      <h3 className="font-semibold text-lg">🎬 分镜镜头</h3>
      {scenes.length === 0 ? (
        <p className="text-muted-foreground text-sm">暂无分镜数据</p>
      ) : (
        scenes.map((scene, si) => (
          <div key={si} className="border rounded-lg p-3 bg-card">
            <h4 className="font-medium text-sm mb-2">
              场景 {scene.index}: {scene.title}
            </h4>
            <div className="grid grid-cols-3 gap-2">
              {scene.shots?.map((shot, i) => (
                <div
                  key={i}
                  className="border rounded p-2 text-xs bg-muted/30"
                >
                  <p className="font-mono">镜头 {shot.idx}</p>
                  <p className="text-muted-foreground line-clamp-2 mt-0.5">
                    {shot.visual_desc}
                  </p>
                  <p className="text-muted-foreground mt-0.5">
                    角度: {shot.angle}
                  </p>
                </div>
              )) ?? (
                <p className="text-xs text-muted-foreground col-span-3">
                  暂无镜头数据
                </p>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
