// ── Zustand WorkflowStore ────────────────────────────────────────────
//
// Granular 6-step workflow store that mirrors all existing CreateDramaPage
// state AND adds WorkflowStep / StepRuntime types from stores/types.ts.
//
// Existing WizardStep (1|2|3|4|5) is preserved for backward compatibility
// until the legacy page is fully migrated.

import { create } from 'zustand'
import type { WorkflowStepName, StepRuntime, StepResult, StepStatus, WizardStep, WsServerEvent, ChatMessage, AgentSuggestion, PendingConfirmation, CharacterInfo, SceneScript, StoryboardScene, SessionStage, PipelineError, PreStepConfirmData, PostStepConfirmData, SyncState, ConfigChange, ArtifactDiff } from '@/stores/types'
import { WORKFLOW_STEPS } from '@/stores/types'
import { logger } from '@/lib/logger'

// ── Connection State ────────────────────────────────────────────────

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

// ── Pipeline Event (legacy, preserved for Step4 backward compat) ────

export type PipelineEvent = {
  type: string
  session_id?: string
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

// ── Store State ─────────────────────────────────────────────────────

export interface WorkflowState {
  // ── Wizard navigation (legacy 5-step) ───────────────────────────
  wizardStep: WizardStep

  // ── Step 1: Idea Input ──────────────────────────────────────────
  idea: string
  style: string
  aiExtractedIdea: string
  aiExtractedStyle: string

  // ── Session ─────────────────────────────────────────────────────
  sessionId: string | null
  loading: boolean
  planError: string

  // ── Step 2: Planning Review ─────────────────────────────────────
  story: string
  characters: CharacterInfo[]
  scenes: SceneScript[]

  // ── Step 3: Storyboard Review ───────────────────────────────────
  storyboardScenes: { index: number; title: string; shots: any[] }[]
  sceneIndex: number
  sceneLoading: boolean

  // ── Step 4: Generation ──────────────────────────────────────────
  cancelled: boolean

  // ── Workflow Steps (granular 6-step) ────────────────────────────
  steps: typeof WORKFLOW_STEPS
  activeStepName: WorkflowStepName | null

  // ── Session Stage (from connected WS event) ─────────────────────
  sessionStage: SessionStage | null

  // ── Navigation ──────────────────────────────────────────────────
  currentStepIndex: number

  // ── Confirmation tracking ───────────────────────────────────────
  confirmedSteps: Set<number>

  // ── Error tracking ──────────────────────────────────────────────
  errors: PipelineError[]

  // ── Step Runtime (three-phase) ──────────────────────────────────
  runtime: Record<string, StepRuntime>

  // ── WebSocket / Connection ──────────────────────────────────────
  connectionState: ConnectionState
  events: PipelineEvent[]
  _wsSendFn: ((event: any) => void) | null
  _wsSendQueue: any[]

  // ── Artifacts ───────────────────────────────────────────────────
  finalVideoUrl: string | null

  // ── Chat ────────────────────────────────────────────────────────
  chatMessages: ChatMessage[]

  // ── Pending Confirmations ───────────────────────────────────────
  pendingConfirmations: PendingConfirmation[]

  // ── Agent Suggestions ───────────────────────────────────────────
  agentSuggestions: AgentSuggestion[]

  // ── Artifact Cache ──────────────────────────────────────────────
  artifacts: Record<string, unknown>

  // ── V3: Bidirectional Confirmation & Sync ───────────────────────
  /** Pre-exec confirmation data set by step:need_confirm_before event */
  preStepConfirmData: PreStepConfirmData | null

  /** Post-exec confirmation data set by step:need_confirm event (structured supplement to pendingConfirmations) */
  postStepConfirmData: PostStepConfirmData | null

  /** Bidirectional sync state driven by sync:* events */
  syncState: SyncState

  /** Tracks which panel last issued a confirmation: WorkArea | ChatPanel | null */
  lastConfirmationSource: 'WorkArea' | 'ChatPanel' | null
}

// ── Store Actions ───────────────────────────────────────────────────

export interface WorkflowActions {
  // Navigation
  setWizardStep: (step: WizardStep) => void

  // Idea input
  setIdea: (idea: string) => void
  setStyle: (style: string) => void
  setAiExtractedIdea: (idea: string) => void
  setAiExtractedStyle: (style: string) => void

  // Session
  setSessionId: (id: string | null) => void
  setSession: (id: string, stage: SessionStage) => void
  clearSession: () => void
  setLoading: (loading: boolean) => void
  setPlanError: (error: string) => void

  // Planning review
  setStory: (story: string) => void
  setCharacters: (characters: CharacterInfo[]) => void
  setScenes: (scenes: SceneScript[]) => void

  // Storyboard
  setStoryboardScenes: (scenes: StoryboardScene[]) => void
  setSceneIndex: (index: number) => void
  setSceneLoading: (loading: boolean) => void

  // Generation
  setCancelled: (cancelled: boolean) => void

  // Workflow steps
  setStepStatus: (stepName: WorkflowStepName, status: StepStatus) => void
  setActiveStepName: (stepName: WorkflowStepName | null) => void
  goToStep: (index: number) => void
  nextStep: () => void
  prevStep: () => void
  confirmStep: (index: number) => void
  requestRegenerate: (index: number, feedback?: string) => void
  requestModify: (index: number, changes: Record<string, unknown>) => void

  // Step Runtime
  initRuntime: (stepName: string) => void
  setRuntimePhase: (stepName: string, phase: StepRuntime['phase']) => void
  setRuntimeProgress: (stepName: string, percent: number, message: string) => void
  appendStream: (stepName: string, chunk: string) => void
  setRuntimeResult: (stepName: string, result: StepResult) => void
  setRuntimeError: (stepName: string, error: string) => void

  // Connection (used by useSessionWebSocket hook)
  setConnectionState: (state: ConnectionState) => void
  handleWsEvent: (event: WsServerEvent) => void
  clearEvents: () => void
  setWsSendFn: (fn: ((event: any) => void) | null) => void
  sendWsMessage: (event: any) => void

  // Artifacts
  setFinalVideoUrl: (url: string | null) => void

  // Chat
  addChatMessage: (role: ChatMessage['role'], content: string, suggestions?: AgentSuggestion[]) => void
  clearChatMessages: () => void

  // Pending Confirmations
  setPendingConfirmation: (confirmation: PendingConfirmation | null) => void

  // Agent Suggestions
  addAgentSuggestion: (suggestion: AgentSuggestion) => void
  dismissSuggestion: (suggestionId: string) => void
  clearAgentSuggestions: () => void
  addError: (error: PipelineError) => void
  clearError: (step: string) => void
  clearAllErrors: () => void

  // Artifact Cache
  updateArtifact: (key: string, content: unknown) => void
  patchArtifact: (key: string, patch: Partial<unknown>) => void

  // Convenience aliases (WS event wiring)
  updateStepRuntime: (stepName: string, patch: Partial<StepRuntime>) => void
  appendStreamedOutput: (stepName: string, chunk: string) => void

  // ── V3: Pre-exec confirmation ─────────────────────────────────
  /** Called by agent/api to request pre-exec confirmation (sets preStepConfirmData) */
  requestPreConfirm: (data: PreStepConfirmData) => void

  /** User response to pre-exec confirmation: accept or reject with optional modified params */
  respondPreConfirm: (stepName: string, accepted: boolean, reply?: string, modifiedParams?: Record<string, unknown>) => void

  // ── V3: Post-exec confirmation (structured) ────────────────────
  /** Set structured post-exec confirmation data */
  setPostStepConfirmData: (data: PostStepConfirmData | null) => void

  // ── V3: Sync state management ──────────────────────────────────
  /** Apply a partial patch to syncState */
  setSyncState: (patch: Partial<SyncState>) => void

  /** Called by step:pre_step_context WS event — stores pipeline progress, artifact status, agent snapshot */
  updateStepContext: (context: { currentProgress: PipelineProgress; availableArtifacts: Record<string, ArtifactStatus>; agentState: AgentStateSnapshot }) => void

  /** Called by sync:confirmation_state WS event — syncs confirmation state across both panels */
  handleSyncConfirmation: (state: ConfirmationSyncState) => void

  /** Clear all V3 confirmation state (pre, post, sync, source) */
  clearConfirmationState: () => void

  /** Track which panel last originated a confirmation */
  setLastConfirmationSource: (source: 'WorkArea' | 'ChatPanel' | null) => void

  /** Append an artifact diff to syncState.artifactDiffs (cap at 50) */
  addArtifactDiff: (diff: ArtifactDiff) => void

  /** Append a config change to syncState.configChanges (cap at 50) */
  addConfigChange: (change: ConfigChange) => void

  // Reset
  reset: () => void
  resetIdea: () => void
  resetGeneration: () => void
}

// ── ID generator ──────────────────────────────────────────────────────

let _msgCounter = 0
function _nextMsgId(): string {
  _msgCounter++
  return `msg_${Date.now()}_${_msgCounter}`
}

// ── Default Runtime factory ─────────────────────────────────────────

function createDefaultRuntime(): Record<string, StepRuntime> {
  const map: Record<string, StepRuntime> = {}
  for (const step of WORKFLOW_STEPS) {
    map[step.name] = {
      stepName: step.name,
      phase: 'preparing',
      startTime: null,
      endTime: null,
      progressPercent: 0,
      progressMessage: '',
      streamedOutput: '',
      result: null,
      error: null,
    }
  }
  return map
}

// ── Initial State ───────────────────────────────────────────────────

const initialState: WorkflowState = {
  wizardStep: 1,
  idea: '',
  style: '',
  aiExtractedIdea: '',
  aiExtractedStyle: '',
  sessionId: null,
  loading: false,
  planError: '',
  story: '',
  characters: [],
  scenes: [],
  storyboardScenes: [],
  sceneIndex: 0,
  sceneLoading: false,
  cancelled: false,
  steps: WORKFLOW_STEPS,
  activeStepName: null,
  sessionStage: null,
  currentStepIndex: 0,
  confirmedSteps: new Set<number>(),
  errors: [],
  runtime: createDefaultRuntime(),
  connectionState: 'disconnected',
  events: [],
  finalVideoUrl: null,
  chatMessages: [],
  pendingConfirmations: [],
  agentSuggestions: [],
  artifacts: {},
  // ── V3 initial values ─────────────────────────────────────────
  preStepConfirmData: null,
  postStepConfirmData: null,
  syncState: {
    lastConfirmationSource: null,
    confirmationState: {
      isPending: false,
      phase: null,
      stepName: null,
      stepIndex: null,
      message: null,
      confirmedBy: null,
      timestamp: null,
      timeoutAt: null,
    },
    configChanges: [],
    artifactDiffs: [],
  },
  lastConfirmationSource: null,
}

// ── Store ───────────────────────────────────────────────────────────

export const useWorkflowStore = create<WorkflowState & WorkflowActions>()((set, get) => ({
  // ── Initial state ──────────────────────────────────────────────
  ...initialState,

  // ── Navigation ─────────────────────────────────────────────────
  setWizardStep: (step) => set({ wizardStep: step }),

  // ── Idea input ─────────────────────────────────────────────────
  setIdea: (idea) => set({ idea }),
  setStyle: (style) => set({ style }),
  setAiExtractedIdea: (idea) => set({ aiExtractedIdea: idea }),
  setAiExtractedStyle: (style) => set({ aiExtractedStyle: style }),

  // ── Session ────────────────────────────────────────────────────
  setSessionId: (id) => set({ sessionId: id }),
  setSession: (id, stage) => set({ sessionId: id, sessionStage: stage }),
  clearSession: () => set({
    sessionId: null,
    sessionStage: null,
    activeStepName: null,
    currentStepIndex: 0,
    confirmedSteps: new Set(),
  }),
  setLoading: (loading) => set({ loading }),
  setPlanError: (error) => set({ planError: error }),

  // ── Planning review ────────────────────────────────────────────
  setStory: (story) => set({ story }),
  setCharacters: (characters) => set({ characters }),
  setScenes: (scenes) => set({ scenes }),

  // ── Storyboard ─────────────────────────────────────────────────
  setStoryboardScenes: (storyboardScenes) => set({ storyboardScenes }),
  setSceneIndex: (index) => set({ sceneIndex: index }),
  setSceneLoading: (sceneLoading) => set({ sceneLoading }),

  // ── Generation ─────────────────────────────────────────────────
  setCancelled: (cancelled) => set({ cancelled }),

  // ── Workflow steps ─────────────────────────────────────────────
  setStepStatus: (stepName, status) =>
    set((state) => ({
      steps: state.steps.map((s) =>
        s.name === stepName ? { ...s, status } : s
      ),
    })),
  setActiveStepName: (stepName) => set({ activeStepName: stepName }),
  goToStep: (index) => {
    const steps = get().steps
    if (index < 0 || index >= steps.length) return
    const step = steps[index]
    set({
      currentStepIndex: index,
      activeStepName: step.name,
    })
  },
  nextStep: () => {
    const idx = get().currentStepIndex
    get().goToStep(idx + 1)
  },
  prevStep: () => {
    const idx = get().currentStepIndex
    get().goToStep(idx - 1)
  },
  confirmStep: (index) =>
    set((state) => {
      const next = new Set(state.confirmedSteps)
      next.add(index)
      return {
        confirmedSteps: next,
        pendingConfirmations: [],
        postStepConfirmData: null,  // ── V3: clear structured post-confirm data ──
      }
    }),
  requestRegenerate: (index, feedback) => {
    const step = get().steps[index]
    if (!step) return
    get().sendWsMessage({
      type: 'user:regenerate',
      step: step.name,
      feedback,
    })
  },
  requestModify: (index, changes) => {
    const step = get().steps[index]
    if (!step) return
    get().sendWsMessage({
      type: 'user:modify',
      step: step.name,
      changes,
    })
  },

  // ── Step Runtime ───────────────────────────────────────────────
  initRuntime: (stepName) =>
    set((state) => ({
      runtime: {
        ...state.runtime,
        [stepName]: {
          stepName,
          phase: 'preparing',
          startTime: Date.now(),
          endTime: null,
          progressPercent: 0,
          progressMessage: '',
          streamedOutput: '',
          result: null,
          error: null,
        },
      },
    })),

  setRuntimePhase: (stepName, phase) =>
    set((state) => {
      const existing = state.runtime[stepName]
      if (!existing) return state
      const now = Date.now()
      return {
        runtime: {
          ...state.runtime,
          [stepName]: {
            ...existing,
            phase,
            startTime: existing.startTime ?? (phase !== 'preparing' ? null : now),
            endTime: phase === 'done' ? now : existing.endTime,
          },
        },
      }
    }),

  setRuntimeProgress: (stepName, percent, message) =>
    set((state) => {
      const existing = state.runtime[stepName]
      if (!existing) return state
      return {
        runtime: {
          ...state.runtime,
          [stepName]: {
            ...existing,
            progressPercent: percent,
            progressMessage: message,
          },
        },
      }
    }),

  appendStream: (stepName, chunk) =>
    set((state) => {
      const existing = state.runtime[stepName]
      if (!existing) return state
      return {
        runtime: {
          ...state.runtime,
          [stepName]: {
            ...existing,
            streamedOutput: existing.streamedOutput + chunk,
          },
        },
      }
    }),

  setRuntimeResult: (stepName, result) =>
    set((state) => {
      const existing = state.runtime[stepName]
      if (!existing) return state
      return {
        runtime: {
          ...state.runtime,
          [stepName]: {
            ...existing,
            result,
            phase: 'done',
            endTime: Date.now(),
            progressPercent: 100,
          },
        },
      }
    }),

  setRuntimeError: (stepName, error) =>
    set((state) => {
      const existing = state.runtime[stepName]
      if (!existing) return state
      return {
        runtime: {
          ...state.runtime,
          [stepName]: {
            ...existing,
            error,
            phase: 'done',
            endTime: Date.now(),
          },
        },
      }
    }),

  // ── Connection / WS events ─────────────────────────────────────
  setConnectionState: (connectionState) => set({ connectionState }),

  clearEvents: () => set({ events: [] }),

  // WS send bridge — populated by useSessionWebSocket
  _wsSendFn: null as ((event: any) => void) | null,
  _wsSendQueue: [] as any[],
  setWsSendFn: (fn: ((event: any) => void) | null) => {
    const queue = get()._wsSendQueue
    set({ _wsSendFn: fn })
    // Flush queued messages when connection becomes available
    if (fn && queue.length > 0) {
      for (const ev of queue) fn(ev)
      set({ _wsSendQueue: [] })
    }
  },
  sendWsMessage: (event: any) => {
    const fn = get()._wsSendFn
    if (fn) {
      fn(event)
    } else {
      // Queue messages until WS connection is ready
      set((state) => ({ _wsSendQueue: [...state._wsSendQueue, event] }))
    }
  },

  handleWsEvent: (event: WsServerEvent) => {
    const state = get()
    const MAX_EVENTS = 500
    const raw: PipelineEvent = { ...(event as any) }

    // Append to the events array (legacy compat for Step4)
    set({ events: [...state.events.slice(-(MAX_EVENTS - 1)), raw] })

    // ── Dispatch new-style events to step runtime ────────────────
    switch (event.type) {
      case 'step:preparing': {
        get().initRuntime(event.step)
        get().setActiveStepName(event.step as WorkflowStepName)
        if (event.context) {
          get().updateStepRuntime(event.step, {
            preparingContext: {
              inputs: event.context.inputs as Record<string, unknown> | undefined,
              constraints: event.context.constraints as string[] | undefined,
              agentIntent: event.context.agentIntent as string | undefined,
            },
          })
        }
        break
      }
      case 'step:running': {
        get().setRuntimePhase(event.step, 'running')
        get().setRuntimeProgress(event.step, event.progress_percent, event.progress_message)
        break
      }
      case 'step:stream_chunk': {
        get().appendStream(event.step, event.chunk)
        break
      }
      case 'step:completed': {
        get().setRuntimeResult(event.step, event.result)
        get().setStepStatus(event.step as WorkflowStepName, 'completed')

        // Fetch full artifacts for story/character/script steps
        const sid = get().sessionId
        if (sid && event.result?.artifactPaths?.length) {
          const base = `/api/files/${sid}/idea2video`
          const store = get()
          for (const p of event.result.artifactPaths) {
            if (p === 'idea2video/story.txt' && !store.story) {
              fetch(`${base}/story.txt`)
                .then(r => r.ok ? r.text() : null)
                .then(t => { if (t) store.setStory(t) })
                .catch(() => {})
            } else if (p === 'idea2video/characters.json' && store.characters.length === 0) {
              fetch(`${base}/characters.json`)
                .then(r => r.ok ? r.json() : null)
                .then(d => { if (d) store.setCharacters(Array.isArray(d) ? d : []) })
                .catch(() => {})
            } else if (p === 'idea2video/script.json' && store.scenes.length === 0) {
              fetch(`${base}/script.json`)
                .then(r => r.ok ? r.json() : null)
                .then(d => { if (d) store.setScenes(Array.isArray(d) ? d : []) })
                .catch(() => {})
            }
          }
        }
        break
      }
      case 'step:error': {
        get().setRuntimeError(event.step, event.error)
        get().setStepStatus(event.step as WorkflowStepName, 'error')
        break
      }
      case 'step:need_confirm': {
        // Keep phase as-is (should be 'done' from step:completed) so the
        // result panel stays visible while waiting for user confirmation.
        const stepIdx = get().steps.find((s) => s.name === event.step)?.index ?? 0
        const stepName = event.step as WorkflowStepName
        get().setPendingConfirmation({
          stepIndex: stepIdx,
          stepName: event.step,
          phase: 'after',          // V3: explicitly mark as post-exec
          message: event.message,
          suggestions: event.suggestions,
          timestamp: Date.now(),
          source: 'ChatPanel',     // Agent-triggered confirmation
        })
        // V3: also set structured post-exec confirmation data
        get().setPostStepConfirmData({
          stepName,
          stepIndex: stepIdx,
          result: get().runtime[event.step]?.result ?? {
            summary: '',
            artifactPaths: [],
            previewData: null,
            editableFields: [],
          },
          message: event.message,
          suggestions: event.suggestions,
          timestamp: Date.now(),
          requestedBy: 'agent',
        })
        break
      }
      case 'artifact:updated': {
        logger.debug('workflowStore: artifact updated', { key: event.artifact_key })
        get().updateArtifact(event.artifact_key, event.content)
        // ── V3: track diff for audit trail ──
        if (event.diff) {
          const oldContent = event.diff.old_value !== undefined ? String(event.diff.old_value) : null
          const newContent = event.diff.new_value !== undefined ? String(event.diff.new_value) : null
          get().addArtifactDiff({
            artifactPath: event.diff.path || event.artifact_key,
            oldContent,
            newContent,
            diff: '',
            changedBy: 'agent',
            source: 'Agent',
            timestamp: Date.now(),
          })
        }
        break
      }
      case 'agent:message': {
        logger.debug('workflowStore: agent message', event.content.slice(0, 80))
        get().addChatMessage('agent', event.content, event.suggestions)
        // Register inline suggestions from agent:message
        if (event.suggestions) {
          for (const suggestion of event.suggestions) {
            get().addAgentSuggestion(suggestion)
          }
        }
        break
      }
      case 'agent:ask': {
        get().addChatMessage('agent', event.question, event.options?.map((opt) => ({
          id: _nextMsgId(),
          type: 'action' as const,
          message: opt.label,
          action: { label: opt.label, type: 'confirm' as const, payload: opt.value },
          dismissed: false,
        })))
        break
      }
      case 'agent:workflow_started': {
        get().setSession(
          (event as any).session_id || get().sessionId || '',
          ((event as any).session_stage as SessionStage) || 'created'
        )
        if ((event as any).current_step) {
          get().setActiveStepName((event as any).current_step as WorkflowStepName)
        }
        break
      }
      case 'pipeline:complete': {
        if (event.final_video_url) {
          get().setFinalVideoUrl(event.final_video_url)
        }
        break
      }
      case 'connected': {
        if (event.current_step) {
          get().setActiveStepName(event.current_step as WorkflowStepName)
        }
        // ── V3: recover pending confirmation state on reconnect ──
        if (event.confirmation_state) {
          get().handleSyncConfirmation(event.confirmation_state)
        }
        break
      }
      case 'agent:reply': {
        get().addChatMessage('agent', (event as any).reply || '')
        break
      }
      case 'agent:regenerate_ack': {
        const step = (event as any).step
        if (step) {
          get().initRuntime(step)
          get().setRuntimePhase(step, 'preparing')
          get().setStepStatus(step as WorkflowStepName, 'idle')
        }
        break
      }
      case 'agent:confirm_ack': {
        // ── V3: phase-aware confirmation acknowledgement ──
        const ackPhase = (event as any).phase
        if (ackPhase === 'before') {
          // Pre-exec confirm ACK — the server has received our confirm/reject.
          // Clear preStepConfirmData and syncState (step hasn't executed yet).
          get().clearConfirmationState()
        } else {
          // Post-exec confirm ACK (or legacy no-phase) — step is done.
          const stepName = (event as any).step
          if (stepName) {
            const stepIdx = get().steps.find((s) => s.name === stepName)?.index
            if (stepIdx !== undefined) get().confirmStep(stepIdx)
          }
          get().clearConfirmationState()
        }
        break
      }
      case 'agent:navigate': {
        const idx = (event as any).step_index
        if (typeof idx === 'number') get().goToStep(idx)
        break
      }
      case 'event:ack': {
        // no-op — confirmation receipt
        break
      }
      case 'event:error': {
        get().addError({
          step: (event as any).event_type || 'ws',
          message: (event as any).error || 'Unknown error',
          timestamp: Date.now(),
          recoverable: false,
        })
        break
      }
      // ── V3: Bidirectional confirmation & sync events ────────────
      case 'step:need_confirm_before': {
        const stepIdx = get().steps.find((s) => s.name === event.step)?.index ?? 0
        const stepName = event.step as WorkflowStepName
        const data: PreStepConfirmData = {
          stepName,
          stepIndex: stepIdx,
          params: event.context.params,
          estimatedDuration: event.context.estimatedDuration,
          dependencies: event.context.dependencies,
          sideEffects: event.context.sideEffects,
          requestedBy: event.source,
          timestamp: Date.now(),
          timeoutMs: 1800000,
        }
        set({ preStepConfirmData: data })
        get().setSyncState({
          confirmationState: {
            isPending: true,
            phase: 'before',
            stepName: event.step,
            stepIndex: stepIdx,
            message: event.message,
            confirmedBy: null,
            timestamp: Date.now(),
            timeoutAt: Date.now() + 1800000,
          },
        })
        break
      }

      case 'step:pre_step_context': {
        // Update agent state snapshot via syncState for downstream consumers
        get().setSyncState({
          confirmationState: {
            ...get().syncState.confirmationState,
            stepName: event.step,
          },
        })
        break
      }

      case 'sync:config_changed': {
        for (const change of event.changes) {
          get().addConfigChange(change)
          get().updateArtifact(change.path, change.newValue)
          // ── V3: propagate idea/style changes to store fields ──
          // Agent-driven creative setting changes should sync to
          // CreativeSettings so both panels stay in sync.
          if (change.path === 'idea' || change.field === 'idea') {
            get().setIdea(String(change.newValue ?? ''))
          }
          if (change.path === 'style' || change.field === 'style') {
            get().setStyle(String(change.newValue ?? ''))
          }
        }
        break
      }

      case 'sync:confirmation_state': {
        get().setSyncState({ confirmationState: event.state })
        get().setLastConfirmationSource(event.state.lastConfirmationSource)
        break
      }

      case 'pong': {
        // no-op — heartbeat response
        break
      }
      // Legacy events — log and pass through
      case 'pipeline_status':
      case 'pipeline_error':
      case 'artifact_ready':
      case 'render_progress':
        break
    }
  },

  // ── Chat ───────────────────────────────────────────────────────
  addChatMessage: (role, content, suggestions) =>
    set((state) => ({
      chatMessages: [
        ...state.chatMessages,
        {
          id: _nextMsgId(),
          role,
          content,
          timestamp: Date.now(),
          suggestions: suggestions ?? [],
        },
      ],
    })),

  clearChatMessages: () => set({ chatMessages: [] }),

  // ── Pending Confirmations ──────────────────────────────────────
  setPendingConfirmation: (confirmation) =>
    set((state) => ({
      pendingConfirmations: confirmation
        ? [...state.pendingConfirmations, confirmation]
        : [],
    })),

  // ── Agent Suggestions ──────────────────────────────────────────
  addAgentSuggestion: (suggestion) =>
    set((state) => ({
      agentSuggestions: [...state.agentSuggestions, suggestion],
    })),

  dismissSuggestion: (suggestionId) =>
    set((state) => ({
      agentSuggestions: state.agentSuggestions.map((s) =>
        s.id === suggestionId ? { ...s, dismissed: true } : s
      ),
    })),

  clearAgentSuggestions: () => set({ agentSuggestions: [] }),
  addError: (error) =>
    set((state) => ({
      errors: [...state.errors, error],
    })),
  clearError: (step) =>
    set((state) => ({
      errors: state.errors.filter((e) => e.step !== step),
    })),
  clearAllErrors: () => set({ errors: [] }),

  // ── Artifact Cache ─────────────────────────────────────────────
  updateArtifact: (key, content) =>
    set((state) => ({
      artifacts: { ...state.artifacts, [key]: content },
    })),
  patchArtifact: (key, patch) =>
    set((state) => ({
      artifacts: {
        ...state.artifacts,
        [key]: {
          ...((state.artifacts[key] as Record<string, unknown>) || {}),
          ...(patch as Record<string, unknown>),
        },
      },
    })),

  // ── Convenience aliases ────────────────────────────────────────
  updateStepRuntime: (stepName, patch) =>
    set((state) => {
      const existing = state.runtime[stepName]
      if (!existing) return state
      return {
        runtime: {
          ...state.runtime,
          [stepName]: { ...existing, ...patch },
        },
      }
    }),

  appendStreamedOutput: (stepName, chunk) =>
    set((state) => {
      const existing = state.runtime[stepName]
      if (!existing) return state
      return {
        runtime: {
          ...state.runtime,
          [stepName]: {
            ...existing,
            streamedOutput: existing.streamedOutput + chunk,
          },
        },
      }
    }),

  // ── Artifacts ──────────────────────────────────────────────────
  setFinalVideoUrl: (url) => set({ finalVideoUrl: url }),

  // ── V3: Pre-exec Confirmation ──────────────────────────────────
  /** Called by agent/api to request pre-exec confirmation. Sets preStepConfirmData and updates syncState. */
  requestPreConfirm: (data) => {
    set({
      preStepConfirmData: data,
      lastConfirmationSource: 'ChatPanel',
    })
    get().setSyncState({
      confirmationState: {
        isPending: true,
        phase: 'before',
        stepName: data.stepName,
        stepIndex: data.stepIndex,
        message: `即将开始: ${data.stepName}`,
        confirmedBy: null,
        timestamp: Date.now(),
        timeoutAt: Date.now() + data.timeoutMs,
      },
    })
  },

  /** User response to pre-exec confirmation. Sends user:confirm_before or user:reject_before over WS. */
  respondPreConfirm: (stepName, accepted, reply, modifiedParams) => {
    const data = get().preStepConfirmData
    if (!data || data.stepName !== stepName) return
    if (accepted) {
      get().sendWsMessage({
        type: 'user:confirm_before',
        session_id: get().sessionId,
        step: stepName,
        phase: 'before',
        payload: {},
        reply: reply ?? '',
      })
    } else {
      get().sendWsMessage({
        type: 'user:reject_before',
        session_id: get().sessionId,
        step: stepName,
        phase: 'before',
        payload: modifiedParams ?? {},
        reply: reply ?? '',
      })
    }
    set({
      preStepConfirmData: null,
      lastConfirmationSource: 'WorkArea',
    })
  },

  // ── V3: Post-exec Confirmation (structured) ────────────────────
  /** Set structured post-exec confirmation data alongside pendingConfirmations. */
  setPostStepConfirmData: (data) => set({ postStepConfirmData: data }),

  // ── V3: Sync State Management ──────────────────────────────────
  /** Apply a partial patch to syncState. Merges nested confirmationState correctly. */
  setSyncState: (patch) =>
    set((state) => ({
      syncState: {
        ...state.syncState,
        ...patch,
        confirmationState: patch.confirmationState
          ? { ...state.syncState.confirmationState, ...patch.confirmationState }
          : state.syncState.confirmationState,
        configChanges: patch.configChanges ?? state.syncState.configChanges,
        artifactDiffs: patch.artifactDiffs ?? state.syncState.artifactDiffs,
      },
    })),

  /** Store pipeline progress, artifact status, and agent snapshot from step:pre_step_context WS event. */
  updateStepContext: (context) =>
    set((state) => ({
      syncState: {
        ...state.syncState,
        confirmationState: {
          ...state.syncState.confirmationState,
          stepName: context.currentProgress.currentStep,
        },
      },
    })),

  /** Sync confirmation state across both panels from sync:confirmation_state WS event. */
  handleSyncConfirmation: (confState) => {
    get().setSyncState({ confirmationState: confState })
    get().setLastConfirmationSource(confState.lastConfirmationSource)
  },

  /** Clear all V3 confirmation state (pre, post, sync confirmationState, source). */
  clearConfirmationState: () =>
    set((state) => ({
      preStepConfirmData: null,
      postStepConfirmData: null,
      lastConfirmationSource: null,
      syncState: {
        ...state.syncState,
        confirmationState: {
          isPending: false,
          phase: null,
          stepName: null,
          stepIndex: null,
          message: null,
          confirmedBy: null,
          timestamp: null,
          timeoutAt: null,
        },
      },
    })),

  /** Track which panel last originated a confirmation. */
  setLastConfirmationSource: (source) =>
    set({ lastConfirmationSource: source }),

  /** Append an artifact diff to syncState.artifactDiffs, capped at 50 entries. */
  addArtifactDiff: (diff) =>
    set((state) => ({
      syncState: {
        ...state.syncState,
        artifactDiffs: [...state.syncState.artifactDiffs.slice(-49), diff],
      },
    })),

  /** Append a config change to syncState.configChanges, capped at 50 entries. */
  addConfigChange: (change) =>
    set((state) => ({
      syncState: {
        ...state.syncState,
        configChanges: [...state.syncState.configChanges.slice(-49), change],
      },
    })),

  // ── Reset ──────────────────────────────────────────────────────
  reset: () => set({ ...initialState }),
  resetIdea: () =>
    set({
      idea: '',
      style: '',
      aiExtractedIdea: '',
      aiExtractedStyle: '',
    }),
  resetGeneration: () =>
    set({
      cancelled: false,
      finalVideoUrl: null,
    }),
}))
