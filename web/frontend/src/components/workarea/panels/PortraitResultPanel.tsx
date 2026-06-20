import type { PortraitEntry } from '@/stores/types'

// PortraitResultPanel — portrait gallery with image preview
export function PortraitResultPanel({
  data,
  onEdit,
}: {
  data: unknown
  onEdit?: (path: string, value: unknown) => void
}) {
  const portraits = (Array.isArray(data) ? data : []) as PortraitEntry[]

  return (
    <div className="portrait-result space-y-4">
      <h3 className="font-semibold text-lg">
        🖼️ 角色肖像 ({portraits.length})
      </h3>
      {portraits.length === 0 ? (
        <p className="text-muted-foreground text-sm">暂无肖像数据</p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {portraits.map((p, i) => (
            <div
              key={i}
              className="border rounded-lg overflow-hidden bg-card"
            >
              {p.image_url ? (
                <img
                  src={p.image_url}
                  alt={`${p.character} ${p.view}`}
                  className="w-full aspect-square object-cover"
                />
              ) : (
                <div className="w-full aspect-square bg-muted flex items-center justify-center text-muted-foreground text-xs">
                  无预览
                </div>
              )}
              <div className="p-2 text-xs">
                <p className="font-medium">{p.character}</p>
                <p className="text-muted-foreground">{p.view}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
