import { useState } from "react";
import type { SceneScript } from "@/stores/types";

// ScriptResultPanel — scene/dialogue list
export function ScriptResultPanel({
  data,
  onEdit,
}: {
  data: unknown;
  onEdit?: (path: string, value: unknown) => void;
}) {
  const scenes = (Array.isArray(data) ? data : []) as SceneScript[];
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
    <div className="script-result space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">
          📜 剧本场景 ({scenes.length})
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
      ) : scenes.length === 0 ? (
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
  );
}
