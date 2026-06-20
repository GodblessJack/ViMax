interface VideoData {
  finalVideoUrl?: string
  thumbnail_url?: string
}

// VideoResultPanel — video player + download
export function VideoResultPanel({
  data,
  onEdit,
}: {
  data: unknown
  onEdit?: (path: string, value: unknown) => void
}) {
  const videoUrl =
    typeof data === 'string'
      ? data
      : (data as VideoData)?.finalVideoUrl || ''

  return (
    <div className="video-result space-y-4">
      <h3 className="font-semibold text-lg">🎥 最终视频</h3>
      {!videoUrl ? (
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
  )
}
