import { useState } from 'react'
import { Film, Monitor, Smartphone, Layout, Play } from 'lucide-react'
import { useWorkflowStore } from '@/stores/workflowStore'
import { PRESET_STYLES } from '@/lib/constants'

import { request } from '@/lib/api'
import { logger } from '@/lib/logger'

const ASPECT_RATIOS = [
  { key: '16:9', label: '横屏 16:9', icon: Monitor, desc: '标准宽屏' },
  { key: '9:16', label: '竖屏 9:16', icon: Smartphone, desc: '手机短视频' },
  { key: '4:3', label: '横屏 4:3', icon: Monitor, desc: '经典比例' },
  { key: '3:4', label: '竖屏 3:4', icon: Smartphone, desc: '人像模式' },
  { key: '6:19', label: '竖屏 6:19', icon: Smartphone, desc: '全屏手机' },
  { key: '19:6', label: '横屏 19:6', icon: Monitor, desc: '超宽荧幕' },
]

export function CreativeSettings() {
  const idea = useWorkflowStore((s) => s.idea)
  const style = useWorkflowStore((s) => s.style)
  const setIdea = useWorkflowStore((s) => s.setIdea)
  const setStyle = useWorkflowStore((s) => s.setStyle)
  const sendWsMessage = useWorkflowStore((s) => s.sendWsMessage)
  const sessionId = useWorkflowStore((s) => s.sessionId)
  const setSessionId = useWorkflowStore((s) => s.setSessionId)
  const setWizardStep = useWorkflowStore((s) => s.setWizardStep)
  const [aspRatio, setAspRatio] = useState('16:9')
  const [localIdea, setLocalIdea] = useState(idea)
  const [starting, setStarting] = useState(false)

  const selectedStyle = PRESET_STYLES.find((s) => s.key === style)

  const handleStartWorkflow = async () => {
    if (starting) return
    setStarting(true)
    try {
      // Step 1: create session if needed
      let sid = sessionId
      if (!sid) {
        const ideaText = localIdea || idea || '创作一个短剧'
        const styleKey = style || 'wuxia'
        const createResp = await request<{ session_id: string }>(
          '/sessions',
          { method: 'POST', body: JSON.stringify({ idea: ideaText, style: styleKey, user_requirement: '' }) },
        )
        sid = createResp.session_id
        setSessionId(sid)
        setWizardStep(2)
        logger.info('CreativeSettings: session created', { sessionId: sid })
      }

      // Step 2: wait briefly for WS connection
      await new Promise(r => setTimeout(r, 800))

      // Step 3: send message to agent via WS
      const message = `我想创作一个短剧：${localIdea || idea}。风格：${selectedStyle?.name || style || '武侠'}。画面比例：${aspRatio}。请开始规划。`
      sendWsMessage({ type: 'user:message', message })
      logger.userAction('start_workflow_from_creative_settings', { sessionId: sid })
    } catch (err) {
      logger.error('CreativeSettings: failed to start workflow', err)
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="creative-settings flex-1 overflow-y-auto p-6 space-y-6">
      <div className="text-center">
        <Film className="w-12 h-12 mx-auto text-primary mb-3" />
        <h2 className="text-xl font-bold">创建你的短剧</h2>
        <p className="text-sm text-muted-foreground mt-1">
          设置创意参数，AI 将为你完成故事、角色、分镜和视频
        </p>
      </div>

      {/* 创意描述 */}
      <div className="space-y-2">
        <label className="text-sm font-medium">📝 创意描述</label>
        <textarea
          value={localIdea}
          onChange={(e) => { setLocalIdea(e.target.value); setIdea(e.target.value) }}
          placeholder="描述你想拍的短剧...例如：一个江湖恩怨的武侠故事，主角被灭门后苦练武功复仇..."
          className="w-full h-24 rounded-xl border bg-background px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring/20"
        />
      </div>

      {/* 风格选择 */}
      <div className="space-y-2">
        <label className="text-sm font-medium">🎨 视觉风格</label>
        <div className="grid grid-cols-3 gap-2">
          {PRESET_STYLES.map((s) => (
            <button
              key={s.key}
              onClick={() => setStyle(s.key)}
              className={`flex flex-col items-center gap-1 rounded-xl border p-3 text-xs transition-all ${
                style === s.key
                  ? 'border-primary bg-primary/10 text-primary font-medium'
                  : 'border-border hover:border-primary/30 hover:bg-muted/50'
              }`}
            >
              <span className="text-lg">{s.emoji}</span>
              <span>{s.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 画面比例 */}
      <div className="space-y-2">
        <label className="text-sm font-medium">
          <Layout className="w-3.5 h-3.5 inline mr-1" />
          画面比例
        </label>
        <div className="grid grid-cols-3 gap-2">
          {ASPECT_RATIOS.map((r) => (
            <button
              key={r.key}
              onClick={() => setAspRatio(r.key)}
              className={`flex flex-col items-center gap-1 rounded-xl border p-2.5 text-xs transition-all ${
                aspRatio === r.key
                  ? 'border-primary bg-primary/10 text-primary font-medium'
                  : 'border-border hover:border-primary/30 hover:bg-muted/50'
              }`}
            >
              <r.icon className="w-4 h-4" />
              <span className="font-medium">{r.key}</span>
              <span className="text-[10px] text-muted-foreground">{r.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 当前选择摘要 */}
      <div className="rounded-xl border bg-muted/30 p-4 text-sm space-y-1">
        <p><span className="text-muted-foreground">创意：</span>{localIdea || '（在左侧对话区描述或上方输入）'}</p>
        <p><span className="text-muted-foreground">风格：</span>{selectedStyle ? `${selectedStyle.emoji} ${selectedStyle.name}` : '（请选择）'}</p>
        <p><span className="text-muted-foreground">比例：</span>{aspRatio}</p>
      </div>

      <button
        onClick={handleStartWorkflow}
        disabled={starting}
        className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Play className="w-4 h-4" />
        {starting ? '正在启动...' : '开始创作'}
      </button>
      <p className="text-xs text-muted-foreground text-center">
        💡 也可以直接在右侧 AI 助手中描述你的创意
      </p>
    </div>
  )
}
