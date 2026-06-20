import { useState } from "react";

// StoryResultPanel — rich text story display with paragraph-aware rendering
export function StoryResultPanel({
  data,
  onEdit,
}: {
  data: unknown;
  onEdit?: (path: string, value: unknown) => void;
}) {
  if (typeof data !== "string") {
    console.warn(`[ViMax] StoryResultPanel: expected string, got ${typeof data}`, data)
  }
  const text = typeof data === "string" ? data : "";
  const paragraphs = text.split("\n\n").filter(Boolean);
  const [editing, setEditing] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");

  const handleParagraphClick = (i: number) => {
    setEditing(i);
    setEditValue(paragraphs[i]);
  };

  const handleSave = (i: number) => {
    const newParagraphs = [...paragraphs];
    newParagraphs[i] = editValue;
    onEdit?.("text", newParagraphs.join("\n\n"));
    setEditing(null);
  };

  return (
    <div className="story-result space-y-4">
      <h3 className="font-semibold text-lg">📖 故事文本</h3>
      {paragraphs.length === 0 ? (
        <p className="text-muted-foreground text-sm">暂无故事内容</p>
      ) : (
        <div className="prose prose-sm max-w-none dark:prose-invert">
          {paragraphs.map((para, i) =>
            editing === i ? (
              <div key={i} className="mb-3">
                <textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => handleSave(i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSave(i);
                    }
                  }}
                  className="w-full p-2 border rounded text-sm min-h-[80px]"
                  autoFocus
                />
              </div>
            ) : (
              <p
                key={i}
                className="mb-3 leading-relaxed cursor-pointer hover:bg-muted/50 rounded p-1 -ml-1 transition-colors"
                onClick={() => handleParagraphClick(i)}
                title="点击编辑"
              >
                {para}
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}
