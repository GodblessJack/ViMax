import { useState } from "react";

interface VideoData {
  finalVideoUrl?: string;
  thumbnail_url?: string;
}

// VideoResultPanel — video player + download
export function VideoResultPanel({
  data,
  onEdit,
}: {
  data: unknown;
  onEdit?: (path: string, value: unknown) => void;
}) {
  const videoUrl =
    typeof data === "string"
      ? data
      : (data as VideoData)?.finalVideoUrl || "";
  if (typeof data !== "string" && !(data && typeof data === "object" && "finalVideoUrl" in (data as object))) {
    console.warn(`[ViMax] VideoResultPanel: expected string or VideoData, got ${typeof data}`, data)
  }
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
    <div className="video-result space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">🎥 最终视频</h3>
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
      ) : !videoUrl ? (
        <p className="text-muted-foreground text-sm">视频尚未生成</p>
      ) : (
        <div className="space-y-3">
          <video
            src={videoUrl}
            controls
            className="w-full rounded-lg border"
            poster={(data as VideoData)?.thumbnail_url}
          />
          <a
            href={videoUrl}
            download
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
          >
            ⬇️ 下载视频
          </a>
        </div>
      )}
    </div>
  );
}
