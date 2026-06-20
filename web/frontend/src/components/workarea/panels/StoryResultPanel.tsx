// StoryResultPanel — rich text story display with paragraph-aware rendering
export function StoryResultPanel({
  data,
  onEdit,
}: {
  data: unknown
  onEdit?: (path: string, value: unknown) => void
}) {
  const text = typeof data === 'string' ? data : ''
  const paragraphs = text.split('\n\n').filter(Boolean)

  return (
    <div className="story-result space-y-4">
      <h3 className="font-semibold text-lg">📖 故事文本</h3>
      {paragraphs.length === 0 ? (
        <p className="text-muted-foreground text-sm">暂无故事内容</p>
      ) : (
        <div className="prose prose-sm max-w-none dark:prose-invert">
          {paragraphs.map((para, i) => (
            <p key={i} className="mb-3 leading-relaxed">
              {para}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
