import { useState } from "react";
import type { CharacterInfo } from "@/stores/types";

// CharacterResultPanel — character card grid
export function CharacterResultPanel({
  data,
  onEdit,
}: {
  data: unknown;
  onEdit?: (path: string, value: unknown) => void;
}) {
  const characters = (Array.isArray(data) ? data : []) as CharacterInfo[];
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editField, setEditField] = useState<
    "identifier" | "static_features" | null
  >(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = (
    idx: number,
    field: "identifier" | "static_features",
    current: string
  ) => {
    setEditingIdx(idx);
    setEditField(field);
    setEditValue(current);
  };

  const saveEdit = () => {
    if (editingIdx !== null && editField) {
      onEdit?.(`characters[${editingIdx}].${editField}`, editValue);
    }
    setEditingIdx(null);
    setEditField(null);
  };

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
              {editingIdx === i && editField === "identifier" ? (
                <input
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={saveEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveEdit();
                    }
                  }}
                  className="font-medium w-full p-1 border rounded text-sm"
                  autoFocus
                />
              ) : (
                <p
                  className="font-medium cursor-pointer hover:bg-muted/50 rounded p-1 -ml-1 transition-colors"
                  onClick={() =>
                    startEdit(i, "identifier", char.identifier)
                  }
                  title="点击编辑名称"
                >
                  {char.identifier}
                </p>
              )}
              {editingIdx === i && editField === "static_features" ? (
                <textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={saveEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      saveEdit();
                    }
                  }}
                  className="text-xs w-full p-1 border rounded mt-1 min-h-[60px]"
                  autoFocus
                />
              ) : (
                <p
                  className="text-xs text-muted-foreground mt-1 line-clamp-2 cursor-pointer hover:bg-muted/50 rounded p-1 -ml-1 transition-colors"
                  onClick={() =>
                    startEdit(i, "static_features", char.static_features)
                  }
                  title="点击编辑特征"
                >
                  {char.static_features}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
