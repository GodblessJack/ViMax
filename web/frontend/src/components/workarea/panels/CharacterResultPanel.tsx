import type { CharacterInfo } from '@/stores/types'

// CharacterResultPanel — character card grid
export function CharacterResultPanel({
  data,
  onEdit,
}: {
  data: unknown
  onEdit?: (path: string, value: unknown) => void
}) {
  const characters = (Array.isArray(data) ? data : []) as CharacterInfo[]

  return (
    <div className="character-result space-y-4">
      <h3 className="font-semibold text-lg">
        👥 角色列表 ({characters.length})
      </h3>
      {characters.length === 0 ? (
        <p className="text-muted-foreground text-sm">暂无角色数据</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {characters.map((char, i) => (
            <div key={i} className="border rounded-lg p-3 bg-card">
              <p className="font-medium">{char.identifier}</p>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {char.static_features}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
