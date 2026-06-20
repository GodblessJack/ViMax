// ── Pipeline Event Types (from WebSocket) ─────────────────────────

export type PipelineEvent = {
  type: 'pipeline_status' | 'artifact_ready' | 'render_progress' | 'pipeline_complete' | 'pipeline_error'
  session_id: string
  stage?: string
  phase?: string
  message?: string
  path?: string
  url?: string
  image_url?: string
  final_video_url?: string
  error?: string
  metadata?: Record<string, unknown>
}

// ── Session Types ──────────────────────────────────────────────────

export type SessionStage = 'created' | 'narrative_planning' | 'narrative_planned' | 'rendering' | 'rendered' | 'error' | 'cancelled'

export type SessionSummary = {
  session_id: string
  idea: string
  style: string
  stage: SessionStage
  summary: string
  created_at: string
  updated_at: string
  has_final_video: boolean
  thumbnail_url: string | null
}

export type SessionDetail = SessionSummary & {
  user_requirement: string
  artifact_checklist: Record<string, boolean>
  working_dir: string
  shot_count: number
}

// ── Wizard Step Types ──────────────────────────────────────────────

export type WizardStep = 1 | 2 | 3 | 4 | 5

export type StyleOption = {
  key: string
  name: string
  emoji: string
  description: string
}

export type CharacterInfo = {
  idx: number
  identifier: string
  static_features: string
  dynamic_features: string
}

export type SceneInfo = {
  index: number
  title: string
  shot_count: number
}

export type ShotInfo = {
  idx: number
  cam_idx: number
  visual_desc: string
  audio_desc: string
  angle: string
}

// ── Work Types ─────────────────────────────────────────────────────

export type WorkItem = {
  session_id: string
  idea: string
  style: string
  created_at: string
  updated_at: string
  duration_seconds: number | null
  shot_count: number
  thumbnail_url: string | null
}
