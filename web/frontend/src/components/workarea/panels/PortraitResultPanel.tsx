import { useState } from "react";
import type { PortraitEntry } from "@/stores/types";
import { validateArrayData } from "./validate";

// PortraitResultPanel — portrait gallery with image preview
export function PortraitResultPanel({
  data,
  onEdit,
}: {
  data: unknown;
  onEdit?: (path: string, value: unknown) => void;
}) {
  const portraits = validateArrayData(data, "PortraitResultPanel") as PortraitEntry[];
  const [showEditor, setShowEditor] = useState(false);
  const [editValue, setEditValue] = useState("");

  const toggleEditor = () => {
    if (!showEditor) {
      setEditValue(JSON.stringify(data, null, 2));
    }
    setShowEditor(!showEditor);
  };

  const saveEdit = () => {
    try {
      const parsed = JSON.parse(editValue);
      onEdit?.("data", parsed);
    } catch {
      // invalid JSON, ignore
    }
    setShowEditor(false);
  };

  return (
    <div className="portrait-result space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">
          🖼️ 角色肖像 ({portraits.length})
        </h3>
        <button
          onClick={toggleEditor}
          className="px-2 py-1 text-xs rounded border hover:bg-muted transition-colors"
        >
          {showEditor ? "关闭" : "编辑"}
        </button>
      </div>
      {showEditor ? (
        <div className="space-y-2">
          <textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="w-full p-2 border rounded text-xs font-mono min-h-[200px]"
          />
          <button
            onClick={saveEdit}
            className="px-3 py-1 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90"
          >
            保存
          </button>
        </div>
      ) : portraits.length === 0 ? (
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
                  loading="lazy"
                  decoding="async"
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
  );
}
