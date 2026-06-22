// ── Workflow Step Types (new — granular 6 steps) ────────────────────

export type WorkflowStepName =
  | 'story_generation'
  | 'character_extraction'
  | 'script_writing'
  | 'storyboard_design'
  | 'character_portraits'
  | 'video_rendering'

export type StepStatus = 'idle' | 'preparing' | 'running' | 'completed' | 'error' | 'skipped'

export interface WorkflowStep {
  index: number
  name: WorkflowStepName
  label: string
  status: StepStatus
  icon: string
  canSkip: boolean
  requiresConfirmation: boolean
  subSteps?: string[]  // per-scene sub-steps for storyboard_design and video_rendering
}

// ── Step Runtime (three-phase display) ───────────────────────────────

export type StepPhase = 'preparing' | 'running' | 'done'

export interface StepRuntime {
  stepName: string
  phase: StepPhase
  startTime: number | null
  endTime: number | null
  progressPercent: number
  progressMessage: string
  streamedOutput: string
  result: StepResult | null
  error: string | null
  preparingContext?: {
    inputs?: Record<string, unknown>
    constraints?: string[]
    agentIntent?: string
  }
}

export interface StepResult {
  summary: string
  artifactPaths: string[]
  previewData: unknown
  editableFields: EditableField[]
}

export interface EditableField {
  path: string
  label: string
  type: 'text' | 'textarea' | 'select' | 'number'
  value: unknown
  options?: { label: string; value: string }[]
}

// ── Artifacts ────────────────────────────────────────────────────────

export interface CharacterInfo {
  idx: number
  identifier: string
  static_features: string
  dynamic_features: string
}

export interface SceneScript {
  index: number
  title: string
  shot_count: number
}

export interface ShotInfo {
  idx: number
  cam_idx: number
  visual_desc: string
  audio_desc: string
  angle: string
}

export interface StoryboardScene {
  index: number
  title: string
  shots: ShotInfo[]
}

export interface PortraitEntry {
  character: string
  view: 'front' | 'side' | 'back'
  image_url: string
  path: string
}

// ── Chat Types ───────────────────────────────────────────────────────

export interface ChatMessage {
  id: string
  role: 'user' | 'agent' | 'system'
  content: string
  timestamp: number
  suggestions?: AgentSuggestion[]
}

export interface AgentSuggestion {
  id: string
  type: 'question' | 'warning' | 'tip' | 'action'
  message: string
  action?: {
    label: string
    type: 'confirm' | 'modify' | 'regenerate' | 'navigate'
    payload: unknown
  }
  dismissed: boolean
}

// ── Pending Confirmation ─────────────────────────────────────────────

export interface PendingConfirmation {
  stepIndex: number
  stepName: string
  phase?: 'before' | 'after'                // V3: distinguish pre-exec vs post-exec confirmation
  message: string
  suggestions: string[]
  timestamp: number
  context?: {                                // V3: pre-exec confirmation parameter context
    params?: Record<string, unknown>
    estimatedDuration?: string
    dependencies?: string[]
    sideEffects?: string[]
  }
  source?: 'WorkArea' | 'ChatPanel'          // V3: which panel originated the confirmation request
}

// ── V3: Pre/Post Step Confirmation Data ────────────────────────────

export interface PreStepConfirmData {
  stepName: WorkflowStepName
  stepIndex: number
  params: Record<string, unknown>     // parameters that will be passed to PipelineService
  estimatedDuration: string           // e.g. "约 30 秒"
  dependencies: string[]              // prerequisite step names
  sideEffects: string[]               // side effect descriptions
  requestedBy: 'agent' | 'user'       // who requested confirmation
  timestamp: number
  timeoutMs: number                   // confirmation timeout in ms, default 1800000
}

export interface PostStepConfirmData {
  stepName: WorkflowStepName
  stepIndex: number
  result: StepResult                  // step execution result
  message: string
  suggestions: string[]
  timestamp: number
  requestedBy: 'agent' | 'user'
}

// ── V3: Sync State & Bidirectional Tracking ─────────────────────────

export interface ConfigChange {
  path: string                         // file path
  field?: string                       // JSON path
  oldValue: unknown
  newValue: unknown
  changedBy: 'user' | 'agent'
  source: 'WorkArea' | 'ChatPanel' | 'Agent'
  timestamp: number
}

export interface ArtifactDiff {
  artifactPath: string
  oldContent: string | null            // null means newly created
  newContent: string | null            // null means deleted
  diff: string                         // unified diff format
  changedBy: 'user' | 'agent'
  source: 'WorkArea' | 'ChatPanel' | 'Agent'
  timestamp: number
}

export interface SyncState {
  lastConfirmationSource: 'WorkArea' | 'ChatPanel' | null
  confirmationState: {
    isPending: boolean
    phase: 'before' | 'after' | null
    stepName: string | null
    stepIndex: number | null
    message: string | null
    confirmedBy: 'user' | 'agent' | null
    timestamp: number | null
    timeoutAt: number | null
  }
  configChanges: ConfigChange[]
  artifactDiffs: ArtifactDiff[]
}

// ── V3: Helper Types for WS Events ──────────────────────────────────

export interface PreStepConfirmContext {
  stepName: string
  params: Record<string, unknown>
  estimatedDuration: string
  dependencies: string[]
  sideEffects: string[]
}

export interface PipelineProgress {
  completedSteps: string[]
  currentStep: string
  totalSteps: number
  completionPercent: number
}

export interface ArtifactStatus {
  exists: boolean
  size?: number
  lastModified?: string
}

export interface AgentStateSnapshot {
  isBusy: boolean
  currentTool: string | null
  waitingForConfirmation: boolean
}

export interface ConfirmationSyncState {
  isPending: boolean
  phase: 'before' | 'after' | null
  stepName: string | null
  stepIndex: number | null
  message: string | null
  suggestions: string[]
  lastConfirmationSource: 'WorkArea' | 'ChatPanel' | null
  confirmedBy: 'user' | 'agent' | null
  timestamp: number | null
  timeoutAt: number | null
}

// ── Pipeline Error ───────────────────────────────────────────────────

export interface PipelineError {
  step: string
  message: string
  timestamp: number
  recoverable: boolean
}

// ── WebSocket Event Types (bidirectional) ───────────────────────────

// Server → Client
export type WsServerEvent =
  | { type: 'step:preparing'; step: string; context: Record<string, unknown> }
  | { type: 'step:running'; step: string; progress_percent: number; progress_message: string }
  | { type: 'step:stream_chunk'; step: string; chunk: string }
  | { type: 'step:completed'; step: string; result: StepResult }
  | { type: 'step:error'; step: string; error: string; recoverable: boolean }
  | { type: 'step:need_confirm'; step: string; message: string; suggestions: string[] }
  | { type: 'artifact:updated'; artifact_key: string; content: unknown; diff?: { path: string; old_value: unknown; new_value: unknown } }
  | { type: 'agent:message'; content: string; suggestions?: AgentSuggestion[] }
  | { type: 'agent:ask'; question: string; options?: { label: string; value: string }[] }
  | { type: 'pipeline:status'; stage: string; message: string }
  | { type: 'pipeline:complete'; stage: string; final_video_url?: string }
  | { type: 'connected'; session_id: string; current_step: string; session_stage: string }
  // New WS event types (V2 architecture alignment)
  | { type: 'agent:workflow_started'; session_id: string; session_stage?: string; message?: string }
  | { type: 'agent:reply'; session_id?: string; reply: string }
  | { type: 'agent:regenerate_ack'; session_id?: string; step?: string }
  | { type: 'agent:confirm_ack'; session_id?: string; step?: string }
  | { type: 'agent:navigate'; session_id?: string; step_index: number; target_step?: string }
  | { type: 'event:ack'; event_type: string; session_id: string }
  | { type: 'event:error'; event_type: string; session_id: string; error: string }
  | { type: 'pong' }
  // Legacy event types (for backward compatibility during migration)
  | { type: 'pipeline_status'; stage?: string; phase?: string; message?: string; metadata?: Record<string, unknown> }
  | { type: 'artifact_ready'; path?: string; url?: string }
  | { type: 'render_progress'; stage?: string; phase?: string; image_url?: string; character?: string; view?: string; shot_idx?: number; metadata?: Record<string, unknown> }
  | { type: 'pipeline_error'; error?: string }
  // === V3: Bidirectional confirmation & sync events ===
  | { type: 'step:need_confirm_before'; step: string; session_id: string; phase: 'before'; message: string; context: PreStepConfirmContext; source: 'agent' }
  | { type: 'step:pre_step_context'; session_id: string; step: string; currentProgress: PipelineProgress; availableArtifacts: Record<string, ArtifactStatus>; agentState: AgentStateSnapshot }
  | { type: 'sync:config_changed'; session_id: string; changedBy: 'user' | 'agent'; source: 'WorkArea' | 'ChatPanel' | 'Agent'; changes: ConfigChange[]; timestamp: number }
  | { type: 'sync:confirmation_state'; session_id: string; state: ConfirmationSyncState }

// Client → Server
export type WsClientEvent =
  | { type: 'user:confirm'; step: string }
  | { type: 'user:modify'; step: string; changes: Record<string, unknown>; feedback?: string }
  | { type: 'user:regenerate'; step: string; feedback?: string }
  | { type: 'user:navigate'; target_step: string }
  | { type: 'user:message'; text: string; context?: { current_step?: string; referenced_artifact?: string } }
  | { type: 'user:action'; action: string; payload?: unknown }
  | { type: 'ping' }
  // === V3: Pre-exec confirmation events ===
  | { type: 'user:confirm_before'; session_id: string; step: string; phase: 'before'; payload?: Record<string, unknown>; reply?: string }
  | { type: 'user:reject_before'; session_id: string; step: string; phase: 'before'; payload?: Record<string, unknown>; reply?: string }

// ── Legacy Session Types (re-exported for compatibility) ────────────

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
}

export type StyleOption = {
  key: string
  name: string
  emoji: string
  description: string
}

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

// ── WizardStep (legacy, kept for backward compat) ────────────────────

export type WizardStep = 1 | 2 | 3 | 4 | 5

// ── Workflow Steps Definition ────────────────────────────────────────

export const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    index: 0,
    name: 'story_generation',
    label: '故事构思',
    status: 'idle',
    icon: 'BookOpen',
    canSkip: false,
    requiresConfirmation: true,
  },
  {
    index: 1,
    name: 'character_extraction',
    label: '角色设计',
    status: 'idle',
    icon: 'Users',
    canSkip: false,
    requiresConfirmation: true,
  },
  {
    index: 2,
    name: 'script_writing',
    label: '剧本写作',
    status: 'idle',
    icon: 'FileText',
    canSkip: false,
    requiresConfirmation: true,
  },
  {
    index: 3,
    name: 'storyboard_design',
    label: '分镜设计',
    status: 'idle',
    icon: 'LayoutGrid',
    canSkip: false,
    requiresConfirmation: true,
    subSteps: ['scene_0', 'scene_1', 'scene_2'],
  },
  {
    index: 4,
    name: 'character_portraits',
    label: '角色肖像',
    status: 'idle',
    icon: 'Image',
    canSkip: true,
    requiresConfirmation: true,
  },
  {
    index: 5,
    name: 'video_rendering',
    label: '视频渲染',
    status: 'idle',
    icon: 'Video',
    canSkip: false,
    requiresConfirmation: false,
    subSteps: ['scene_0', 'scene_1', 'scene_2'],
  },
]
