import { Download, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'

type Step5Props = {
  sessionId: string
}

export default function Step5PreviewExport({ sessionId }: Step5Props) {
  const videoUrl = `/api/files/${sessionId}/idea2video/final_video.mp4`
  const downloadUrl = `/api/works/${sessionId}/download`

  return (
    <div className="page-enter">
      <h2 className="text-xl font-bold mb-1">预览导出</h2>
      <p className="text-sm text-muted-foreground mb-6">你的短剧已生成，预览并下载</p>

      <div className="rounded-xl overflow-hidden bg-black shadow-lg mb-6 ring-1 ring-white/10">
        <video
          controls
          className="w-full max-h-[450px]"
          src={videoUrl}
          poster={`/api/files/${sessionId}/idea2video/scene_0/shots/0/first_frame.png`}
        >
          Your browser does not support video playback.
        </video>
      </div>

      <div className="flex gap-3">
        <a
          href={downloadUrl}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-primary-foreground hover:bg-[#E84A4F] transition-all font-semibold shadow-sm hover:shadow-md active:scale-[0.98]"
        >
          <Download className="h-5 w-5" />
          下载 MP4
        </a>
        <Link
          to="/create"
          className="inline-flex items-center gap-2 rounded-xl border px-5 py-3 text-sm font-medium hover:bg-muted transition-colors"
        >
          <Plus className="h-4 w-4" />
          创建下一个短剧
        </Link>
      </div>
    </div>
  )
}
