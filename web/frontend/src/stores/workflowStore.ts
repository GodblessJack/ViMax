// ── Zustand WorkflowStore ────────────────────────────────────────────
//
// Granular 6-step workflow store that mirrors all existing CreateDramaPage
// state AND adds WorkflowStep / StepRuntime types from stores/types.ts.
//
// Existing WizardStep (1|2|3|4|5) is preserved for backward compatibility
// until the legacy page is fully migrated.

import { create } from 'zustand'
import type { WorkflowStepName, StepRuntime, StepResult, StepStatus, WizardStep, WsServerEvent, ChatMessage, AgentSuggestion, PendingConfirmation } from '@/stores/types'
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
  characters: any[]
  scenes: any[]

  // ── Step 3: Storyboard Review ───────────────────────────────────
  storyboardScenes: { index: number; title: string; shots: any[] }[]
  sceneIndex: number
  sceneLoading: boolean

  // ── Step 4: Generation ──────────────────────────────────────────
  cancelled: boolean

  // ── Workflow Steps (granular 6-step) ────────────────────────────
  steps: typeof WORKFLOW_STEPS
  activeStepName: WorkflowStepName | null

  // ── Step Runtime (three-phase) ──────────────────────────────────
  runtime: Record<string, StepRuntime>

  // ── WebSocket / Connection ──────────────────────────────────────
  connectionState: ConnectionState
  events: PipelineEvent[]

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
  setLoading: (loading: boolean) => void
  setPlanError: (error: string) => void

  // Planning review
  setStory: (story: string) => void
  setCharacters: (characters: any[]) => void
  setScenes: (scenes: any[]) => void

  // Storyboard
  setStoryboardScenes: (scenes: { index: number; title: string; shots: any[] }[]) => void
  setSceneIndex: (index: number) => void
  setSceneLoading: (loading: boolean) => void

  // Generation
  setCancelled: (cancelled: boolean) => void

  // Workflow steps
  setStepStatus: (stepName: WorkflowStepName, status: StepStatus) => void
  setActiveStepName: (stepName: WorkflowStepName | null) => void

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

  // Artifact Cache
  updateArtifact: (key: string, content: unknown) => void

  // Convenience aliases (WS event wiring)
  updateStepRuntime: (stepName: string, patch: Partial<StepRuntime>) => void
  appendStreamedOutput: (stepName: string, chunk: string) => void

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
  runtime: createDefaultRuntime(),
  connectionState: 'disconnected',
  events: [],
  finalVideoUrl: null,
  chatMessages: [],
  pendingConfirmations: [],
  agentSuggestions: [],
  artifacts: {},
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
        break
      }
      case 'step:error': {
        get().setRuntimeError(event.step, event.error)
        get().setStepStatus(event.step as WorkflowStepName, 'error')
        break
      }
      case 'step:need_confirm': {
        get().setRuntimePhase(event.step, 'running')
        get().setPendingConfirmation({
          stepIndex: get().steps.find((s) => s.name === event.step)?.index ?? 0,
          stepName: event.step,
          message: event.message,
          suggestions: event.suggestions,
          timestamp: Date.now(),
        })
        break
      }
      case 'artifact:updated': {
        logger.debug('workflowStore: artifact updated', { key: event.artifact_key })
        get().updateArtifact(event.artifact_key, event.content)
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

  // ── Artifact Cache ─────────────────────────────────────────────
  updateArtifact: (key, content) =>
    set((state) => ({
      artifacts: { ...state.artifacts, [key]: content },
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
