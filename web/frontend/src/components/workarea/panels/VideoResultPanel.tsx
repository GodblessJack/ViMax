import { useState, useCallback } from "react";

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
  const [downloading, setDownloading] = useState(false);

  const handleDownload = useCallback(async () => {
    if (!videoUrl) return;
    setDownloading(true);
    try {
      const response = await fetch(videoUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = "final_video.mp4";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.warn("[ViMax] Video download failed (cross-origin or network error):", err);
      // Fallback: open in new tab so user can right-click save
      window.open(videoUrl, "_blank");
    } finally {
      setDownloading(false);
    }
  }, [videoUrl]);

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
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {downloading ? "下载中..." : "⬇️ 下载视频"}
          </button>
        </div>
      )}
    </div>
  );
}
