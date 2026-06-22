# ViMax Web Architecture V3 — Precision Design Document

> **Status**: Design Specification (implementation-ready — no additional design decisions needed)
> **Date**: 2026-06-22
> **Source**: Deep analysis of 13 source files + 10 identified architectural gaps
> **Governing Rule**: CLAUDE.md — "修改 agent_tools.py 时须同步更新 docs/architecture-v2-design.md"; V3 replaces V2 as design source.

---

## Table of Contents

1. [Section 1: 新增WS事件类型](#section-1-新增ws事件类型)
2. [Section 2: TypeScript类型扩展](#section-2-typescript类型扩展)
3. [Section 3: WorkflowStore状态扩展](#section-3-workflowstore状态扩展)
4. [Section 4: Agent工具重构](#section-4-agent工具重构)
5. [Section 5: ConfirmationGate组件Props接口](#section-5-confirmationgate组件props接口)
6. [Section 6: 双向同步数据流](#section-6-双向同步数据流)
7. [Section 7: 文件级变更清单](#section-7-文件级变更清单)
8. [Section 8: 向后兼容保证](#section-8-向后兼容保证)
9. [Appendix A: 10 Gaps → Solutions](#appendix-a-10个缺口与v3解决方案对照表)
10. [Appendix B: PipelineService 新增公开方法签名汇总](#appendix-b-新增-pipelineservice-公开方法签名汇总)

---

## Section 1: 新增WS事件类型

### 1.1 Server→Client 新增事件 (完整JSON字面量)

#### `step:need_confirm_before` — 预执行确认

Agent在调用PipelineService之前广播此事件，请求用户确认即将执行的步骤。

```
{
  "type": "step:need_confirm_before",
  "step": "story_generation",
  "session_id": "sess_abc123",
  "phase": "before",
  "message": "即将开始故事构思，参数如下:",
  "context": {
    "stepName": "story_generation",
    "params": {
      "idea": "15秒小猫打败老虎",
      "style": "comedy",
      "user_requirement": "要搞笑"
    },
    "estimatedDuration": "约 30 秒",
    "dependencies": [],
    "sideEffects": [
      "会在会话工作区创建 idea2video/story.txt",
      "会调用 LLM 生成故事文本"
    ]
  },
  "source": "agent"
}
```

触发时机: `tool_run_step` 在实际调用 PipelineService 之前 (当 `require_confirm_before=true`)
语义: "我即将执行步骤X，参数是Y，是否继续?"

#### `step:pre_step_context` — 步骤前置上下文

在 step:preparing 之前广播，为 WorkArea 和 ChatPanel 提供完整上下文快照。

```
{
  "type": "step:pre_step_context",
  "session_id": "sess_abc123",
  "step": "character_extraction",
  "currentProgress": {
    "completedSteps": ["story_generation"],
    "currentStep": "character_extraction",
    "totalSteps": 6,
    "completionPercent": 16.7
  },
  "availableArtifacts": {
    "story.txt": { "exists": true, "size": 2048, "lastModified": "2026-06-22T10:00:00Z" },
    "characters.json": { "exists": false },
    "script.json": { "exists": false }
  },
  "agentState": {
    "isBusy": true,
    "currentTool": "run_step",
    "waitingForConfirmation": false
  }
}
```

#### `sync:config_changed` — 配置变更同步

当用户或Agent修改了产物文件时广播。

```
{
  "type": "sync:config_changed",
  "session_id": "sess_abc123",
  "changedBy": "user",
  "source": "WorkArea",
  "changes": [
    {
      "path": "idea2video/characters.json",
      "field": "characters[0].identifier_in_scene",
      "oldValue": "林风",
      "newValue": "林风(少年)",
      "diff": "+ 林风(少年)\n- 林风"
    }
  ],
  "timestamp": 1687449600000
}
```

#### `sync:confirmation_state` — 确认状态同步

任何确认相关操作 (发确认/确认/拒绝/修改) 后广播，保证双面板状态一致。

```
{
  "type": "sync:confirmation_state",
  "session_id": "sess_abc123",
  "state": {
    "isPending": true,
    "phase": "after",
    "stepName": "story_generation",
    "stepIndex": 0,
    "message": "故事构思已完成，请审阅确认",
    "suggestions": ["确认", "重新生成", "需要修改"],
    "lastConfirmationSource": "WorkArea",
    "confirmedBy": null,
    "timestamp": 1687449600000,
    "timeoutAt": 1687451400000
  }
}
```

### 1.2 Client→Server 新增事件

```
// 预执行确认: 用户确认Agent可以开始执行步骤
{
  "type": "user:confirm_before",
  "session_id": "sess_abc123",
  "step": "story_generation",
  "phase": "before",
  "payload": {},
  "reply": "可以，但把风格改成悬疑"
}

// 预执行拒绝: 用户拒绝Agent执行步骤，可附带修改要求
{
  "type": "user:reject_before",
  "session_id": "sess_abc123",
  "step": "story_generation",
  "phase": "before",
  "payload": {
    "style": "suspense",
    "idea": "一只猫在深夜的城市里冒险"
  },
  "reply": "改成悬疑风格，深夜城市背景"
}
```

### 1.3 后端 CLIENT_EVENT_TYPES 更新

```python
# 文件: web/backend/routers/ws.py

CLIENT_EVENT_TYPES = frozenset({
    "user:confirm",          # 保留: 步骤后确认
    "user:modify",           # 保留: 修改请求
    "user:regenerate",       # 保留: 重新生成
    "user:navigate",         # 保留: 导航
    "user:message",          # 保留: 聊天消息
    "user:action",           # 保留: 通用操作
    "ping",                  # 保留: 心跳
    "user:confirm_before",   # V3 新增: 预执行确认
    "user:reject_before",    # V3 新增: 预执行拒绝
})
```

---

## Section 2: TypeScript类型扩展

### 2.1 PendingConfirmation 扩展 (修改现有接口)

```typescript
// 文件: frontend/src/stores/types.ts
// 在现有 PendingConfirmation 基础上扩展:

export interface PendingConfirmation {
  stepIndex: number
  stepName: string
  phase: 'before' | 'after'        // V3 新增: 区分执行前/执行后确认
  message: string
  suggestions: string[]
  timestamp: number
  // V3 新增字段:
  context?: {                       // 执行前确认附带的参数上下文
    params?: Record<string, unknown>
    estimatedDuration?: string
    dependencies?: string[]
    sideEffects?: string[]
  }
  source?: 'WorkArea' | 'ChatPanel' // V3 新增: 确认请求来源
}
```

### 2.2 PreStepConfirmData 接口 (新增)

```typescript
// 文件: frontend/src/stores/types.ts
// 预执行确认的完整数据结构

export interface PreStepConfirmData {
  stepName: WorkflowStepName
  stepIndex: number
  params: Record<string, unknown>     // 将传递给 PipelineService 的参数
  estimatedDuration: string           // 预估耗时，如 "约 30 秒"
  dependencies: string[]              // 前置依赖步骤名称列表
  sideEffects: string[]               // 副作用说明
  requestedBy: 'agent' | 'user'       // 谁请求的确认
  timestamp: number
  timeoutMs: number                   // 确认超时时间 (ms)，默认 1800000
}
```

### 2.3 PostStepConfirmData 接口 (新增)

```typescript
// 文件: frontend/src/stores/types.ts
// 执行后确认的完整数据结构

export interface PostStepConfirmData {
  stepName: WorkflowStepName
  stepIndex: number
  result: StepResult                  // 步骤执行结果
  message: string
  suggestions: string[]
  timestamp: number
  requestedBy: 'agent' | 'user'
}
```

### 2.4 SyncState 及相关接口 (新增)

```typescript
// 文件: frontend/src/stores/types.ts

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

export interface ConfigChange {
  path: string                         // 文件路径
  field?: string                       // JSON path
  oldValue: unknown
  newValue: unknown
  changedBy: 'user' | 'agent'
  source: 'WorkArea' | 'ChatPanel' | 'Agent'
  timestamp: number
}

export interface ArtifactDiff {
  artifactPath: string
  oldContent: string | null            // null 表示新创建
  newContent: string | null            // null 表示删除
  diff: string                         // unified diff 格式
  changedBy: 'user' | 'agent'
  source: 'WorkArea' | 'ChatPanel' | 'Agent'
  timestamp: number
}
```

### 2.5 WsServerEvent 和 WsClientEvent 完整联合类型

```typescript
// 文件: frontend/src/stores/types.ts

// ── 辅助类型 (V3 新增) ──
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

// ── 完整 Server→Client 事件联合类型 ──
// 现有事件保持不变，仅追加 V3 新增事件:

export type WsServerEvent =
  // === 现有事件 (保持不变) ===
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
  | { type: 'agent:workflow_started'; session_id: string; session_stage?: string; message?: string }
  | { type: 'agent:reply'; session_id?: string; reply: string }
  | { type: 'agent:regenerate_ack'; session_id?: string; step?: string }
  | { type: 'agent:confirm_ack'; session_id?: string; step?: string }
  | { type: 'agent:navigate'; session_id?: string; step_index: number; target_step?: string }
  | { type: 'event:ack'; event_type: string; session_id: string }
  | { type: 'event:error'; event_type: string; session_id: string; error: string }
  | { type: 'pong' }
  // Legacy events (保持向后兼容)
  | { type: 'pipeline_status'; stage?: string; phase?: string; message?: string; metadata?: Record<string, unknown> }
  | { type: 'artifact_ready'; path?: string; url?: string }
  | { type: 'render_progress'; stage?: string; phase?: string; image_url?: string; character?: string; view?: string; shot_idx?: number; metadata?: Record<string, unknown> }
  | { type: 'pipeline_error'; error?: string }
  // === V3 新增事件 ===
  | { type: 'step:need_confirm_before'; step: string; session_id: string; phase: 'before'; message: string; context: PreStepConfirmContext; source: 'agent' }
  | { type: 'step:pre_step_context'; session_id: string; step: string; currentProgress: PipelineProgress; availableArtifacts: Record<string, ArtifactStatus>; agentState: AgentStateSnapshot }
  | { type: 'sync:config_changed'; session_id: string; changedBy: 'user' | 'agent'; source: 'WorkArea' | 'ChatPanel' | 'Agent'; changes: ConfigChange[]; timestamp: number }
  | { type: 'sync:confirmation_state'; session_id: string; state: ConfirmationSyncState }

// ── 完整 Client→Server 事件联合类型 ──
export type WsClientEvent =
  // === 现有事件 (保持不变) ===
  | { type: 'user:confirm'; step: string }
  | { type: 'user:modify'; step: string; changes: Record<string, unknown>; feedback?: string }
  | { type: 'user:regenerate'; step: string; feedback?: string }
  | { type: 'user:navigate'; target_step: string }
  | { type: 'user:message'; text: string; context?: { current_step?: string; referenced_artifact?: string } }
  | { type: 'user:action'; action: string; payload?: unknown }
  | { type: 'ping' }
  // === V3 新增事件 ===
  | { type: 'user:confirm_before'; session_id: string; step: string; phase: 'before'; payload?: Record<string, unknown>; reply?: string }
  | { type: 'user:reject_before'; session_id: string; step: string; phase: 'before'; payload?: Record<string, unknown>; reply?: string }
```

---

## Section 3: WorkflowStore状态扩展

### 3.1 WorkflowState 新增属性

```typescript
// 文件: frontend/src/stores/workflowStore.ts
// 在现有 WorkflowState 接口中追加以下属性 (不删除任何现有属性):

export interface WorkflowState {
  // ... 所有现有属性保持不变 ...

  // ── V3 新增 ──────────────────────────────────────────
  /** 预执行确认数据 (step:need_confirm_before 事件设置) */
  preStepConfirmData: PreStepConfirmData | null

  /** 执行后确认数据 (step:need_confirm 事件设置, 结构化补充 pendingConfirmations) */
  postStepConfirmData: PostStepConfirmData | null

  /** 双向同步状态 (sync:* 事件驱动) */
  syncState: SyncState

  /** 确认来源追踪: WorkArea | ChatPanel | null */
  lastConfirmationSource: 'WorkArea' | 'ChatPanel' | null
}
```

### 3.2 WorkflowActions 新增签名

```typescript
// 文件: frontend/src/stores/workflowStore.ts
// 在现有 WorkflowActions 接口中追加:

export interface WorkflowActions {
  // ... 所有现有 actions 保持不变 ...

  // ── V3 新增: 预执行确认 ────────────────────────────
  setPreStepConfirmData: (data: PreStepConfirmData | null) => void
  confirmBeforeStep: (stepName: string) => void
  rejectBeforeStep: (stepName: string, reply?: string, modifiedParams?: Record<string, unknown>) => void

  // ── V3 新增: 执行后确认 (结构化) ───────────────────
  setPostStepConfirmData: (data: PostStepConfirmData | null) => void

  // ── V3 新增: 同步状态管理 ──────────────────────────
  updateSyncState: (patch: Partial<SyncState>) => void
  setLastConfirmationSource: (source: 'WorkArea' | 'ChatPanel' | null) => void
  addArtifactDiff: (diff: ArtifactDiff) => void
  addConfigChange: (change: ConfigChange) => void
}
```

### 3.3 handleWsEvent 新增 case

```typescript
// 文件: frontend/src/stores/workflowStore.ts
// handleWsEvent 的 switch 语句中新增以下 case (追加到现有 case 之后):

case 'step:need_confirm_before': {
  const stepIdx = get().steps.find(s => s.name === event.step)?.index ?? 0
  get().setPreStepConfirmData({
    stepName: event.step as WorkflowStepName,
    stepIndex: stepIdx,
    params: event.context.params,
    estimatedDuration: event.context.estimatedDuration,
    dependencies: event.context.dependencies,
    sideEffects: event.context.sideEffects,
    requestedBy: event.source,
    timestamp: Date.now(),
    timeoutMs: 1800000,
  })
  get().updateSyncState({
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
  // 更新Agent状态快照 (agentState 嵌入 syncState 间接管理)
  break
}

case 'sync:config_changed': {
  for (const change of event.changes) {
    get().addConfigChange(change)
    get().updateArtifact(change.path, change.newValue)
  }
  break
}

case 'sync:confirmation_state': {
  get().updateSyncState({ confirmationState: event.state })
  get().setLastConfirmationSource(event.state.lastConfirmationSource)
  break
}

// step:need_confirm 现有处理需增强，追加 postStepConfirmData:
case 'step:need_confirm': {
  // 保留现有 setPendingConfirmation 调用
  const stepIdx = get().steps.find(s => s.name === event.step)?.index ?? 0
  get().setPendingConfirmation({
    stepIndex: stepIdx,
    stepName: event.step,
    phase: 'after',          // V3: 明确标注
    message: event.message,
    suggestions: event.suggestions,
    timestamp: Date.now(),
    source: 'WorkArea',      // 默认来源 (Agent触发)
  })
  // V3 新增: 同时设置结构化确认数据
  get().setPostStepConfirmData({
    stepName: event.step as WorkflowStepName,
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
```

### 3.4 新增 Action 实现

```typescript
// 文件: frontend/src/stores/workflowStore.ts
// 在 store 创建函数中新增以下实现:

// ── V3: 预执行确认 ────────────────────────────────────
setPreStepConfirmData: (data) => set({ preStepConfirmData: data }),

confirmBeforeStep: (stepName) => {
  const data = get().preStepConfirmData
  if (!data || data.stepName !== stepName) return
  get().sendWsMessage({
    type: 'user:confirm_before',
    session_id: get().sessionId,
    step: stepName,
    phase: 'before',
    payload: {},
    reply: '',
  })
  set({
    preStepConfirmData: null,
    lastConfirmationSource: 'WorkArea',
  })
},

rejectBeforeStep: (stepName, reply, modifiedParams) => {
  get().sendWsMessage({
    type: 'user:reject_before',
    session_id: get().sessionId,
    step: stepName,
    phase: 'before',
    payload: modifiedParams ?? {},
    reply: reply ?? '',
  })
  set({
    preStepConfirmData: null,
    lastConfirmationSource: 'WorkArea',
  })
},

// ── V3: 执行后确认 ────────────────────────────────────
setPostStepConfirmData: (data) => set({ postStepConfirmData: data }),

// ── V3: 同步状态 ──────────────────────────────────────
updateSyncState: (patch) =>
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

setLastConfirmationSource: (source) =>
  set({ lastConfirmationSource: source }),

addArtifactDiff: (diff) =>
  set((state) => ({
    syncState: {
      ...state.syncState,
      artifactDiffs: [...state.syncState.artifactDiffs.slice(-49), diff],
    },
  })),

addConfigChange: (change) =>
  set((state) => ({
    syncState: {
      ...state.syncState,
      configChanges: [...state.syncState.configChanges.slice(-49), change],
    },
  })),
```

### 3.5 初始状态追加

```typescript
// 文件: frontend/src/stores/workflowStore.ts
// initialState 中追加:

const initialState: WorkflowState = {
  // ... 所有现有初始值保持不变 ...
  // V3 新增:
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
```

---

## Section 4: Agent工具重构

### 4.1 工具总览

| # | 工具名称 | 类型 | 变更 | 描述 |
|---|---------|------|------|------|
| 1 | `get_session_state` | 核心 | 增强 | 获取会话状态 (新增 pipeline_progress 和 confirmation 字段) |
| 2 | `read_artifact` | 核心 | 增强 | 读取产物文件 (新增 offset/limit 片段读取) |
| 3 | `run_step` | 核心 | **重构** | 执行单个步骤 (路由到 PipelineService 公开方法, 支持预确认和子步骤) |
| 4 | `update_artifact` | 核心 | 增强 | 修改产物文件 (自动生成 diff, 广播 sync:config_changed) |
| 5 | `request_confirmation` | 核心 | 增强 | 请求用户确认 (新增 phase: before/after) |
| 6 | `inspect_pipeline` | **新增** | 新增 | 内省 Pipeline 详细状态 (每步骤进度、子步骤、耗时) |
| 7 | `ask_user` | 辅助 | 不变 | 向用户提问 |
| 8 | `navigate_to_step` | 辅助 | 不变 | 导航到步骤 |
| 9 | `restart_workflow` | 辅助 | 不变 | 重启工作流 |

移除: `skip_step` (功能合并到 `run_step` 的错误处理流程中)

### 4.2 工具1: `get_session_state` (增强)

```json
{
  "name": "get_session_state",
  "description": "获取当前会话的完整状态，包括阶段、创意、风格、产物清单、Pipeline进度和确认状态",
  "input_schema": {
    "type": "object",
    "properties": {
      "session_id": {
        "type": "string",
        "description": "会话标识符"
      },
      "include_pipeline_progress": {
        "type": "boolean",
        "description": "是否包含 Pipeline 详细进度信息 (默认 true)",
        "default": true
      },
      "include_confirmations": {
        "type": "boolean",
        "description": "是否包含当前确认状态 (默认 true)",
        "default": true
      }
    },
    "required": ["session_id"]
  }
}
```

调用的 PipelineService 公开方法:
```python
PipelineService.get_session_state(session_id, include_pipeline_progress, include_confirmations) -> dict
```

### 4.3 工具2: `read_artifact` (增强)

```json
{
  "name": "read_artifact",
  "description": "读取会话工作目录下的产物文件内容。支持全量读取和片段读取。",
  "input_schema": {
    "type": "object",
    "properties": {
      "session_id": {
        "type": "string",
        "description": "会话标识符"
      },
      "artifact_path": {
        "type": "string",
        "description": "产物相对路径，如 idea2video/story.txt"
      },
      "offset": {
        "type": "integer",
        "description": "起始行号 (0-based)，用于片段读取"
      },
      "limit": {
        "type": "integer",
        "description": "最大返回行数，默认 200",
        "default": 200
      }
    },
    "required": ["session_id", "artifact_path"]
  }
}
```

调用的 PipelineService 公开方法:
```python
PipelineService.read_artifact(session_id, artifact_path, offset=None, limit=200) -> str
```

### 4.4 工具3: `run_step` (重构 — V3最核心变更)

```json
{
  "name": "run_step",
  "description": "执行单个流水线步骤。每个步骤独立执行，Agent可以在步骤间插入确认和修改。\n\n支持的步骤:\n- story_generation: 仅生成故事文本 (不连带执行后续步骤)\n- character_extraction: 仅从故事中提取角色\n- script_writing: 仅编写分场景剧本\n- storyboard_design: 为所有场景设计分镜\n- storyboard_design_scene: 为单个场景设计分镜 (scene_index 参数必填)\n- character_portraits: 生成所有角色肖像\n- character_portraits_single: 生成单个角色肖像 (character_index 参数必填)\n- video_rendering: 渲染所有场景视频\n- video_rendering_scene: 渲染单个场景视频 (scene_index 参数必填)\n\nAgent 应当遵循的模式:\n1. 调用 run_step(story_generation) 生成故事\n2. 调用 request_confirmation(phase='after') 请用户确认\n3. 如果用户要求修改，调用 update_artifact 修改文件\n4. 调用 run_step(character_extraction) 提取角色\n5. 重复确认循环...",
  "input_schema": {
    "type": "object",
    "properties": {
      "session_id": {
        "type": "string",
        "description": "会话标识符"
      },
      "step_name": {
        "type": "string",
        "description": "要执行的步骤名称",
        "enum": [
          "story_generation",
          "character_extraction",
          "script_writing",
          "storyboard_design",
          "storyboard_design_scene",
          "character_portraits",
          "character_portraits_single",
          "video_rendering",
          "video_rendering_scene"
        ]
      },
      "params": {
        "type": "object",
        "description": "步骤参数",
        "properties": {
          "idea": {
            "type": "string",
            "description": "创意描述 (story_generation 必填)"
          },
          "style": {
            "type": "string",
            "description": "风格 (story_generation 必填)"
          },
          "user_requirement": {
            "type": "string",
            "description": "额外用户需求"
          },
          "scene_index": {
            "type": "integer",
            "description": "场景索引 (storyboard_design_scene / video_rendering_scene 必填)"
          },
          "character_index": {
            "type": "integer",
            "description": "角色索引 (character_portraits_single 必填)"
          },
          "feedback": {
            "type": "string",
            "description": "用户反馈 (重新生成时使用)"
          }
        }
      },
      "require_confirm_before": {
        "type": "boolean",
        "description": "是否在执行前请求用户确认 (默认 true，Agent 可设 false 跳过预确认)",
        "default": true
      }
    },
    "required": ["session_id", "step_name"]
  }
}
```

调用的 PipelineService 公开方法 (根据 step_name 路由):

| step_name | PipelineService 方法 |
|-----------|---------------------|
| `story_generation` | `run_story_generation(session_id, idea, style, user_requirement, progress_callback)` |
| `character_extraction` | `run_character_extraction(session_id, progress_callback)` |
| `script_writing` | `run_script_writing(session_id, user_requirement, progress_callback)` |
| `storyboard_design` | `run_storyboard_design(session_id, user_requirement, style, scene_index=None, progress_callback)` |
| `storyboard_design_scene` | `run_storyboard_design(session_id, user_requirement, style, scene_index=N, progress_callback)` |
| `character_portraits` | `run_character_portraits(session_id, character_index=None, progress_callback)` |
| `character_portraits_single` | `run_character_portraits(session_id, character_index=N, progress_callback)` |
| `video_rendering` | `run_video_rendering(session_id, scene_index=None, progress_callback)` |
| `video_rendering_scene` | `run_video_rendering(session_id, scene_index=N, progress_callback)` |

### 4.5 工具4: `update_artifact` (增强)

```json
{
  "name": "update_artifact",
  "description": "写入或覆盖会话工作目录下的产物文件。会自动生成 diff 并通过 WS 广播变更 (sync:config_changed)。",
  "input_schema": {
    "type": "object",
    "properties": {
      "session_id": {
        "type": "string",
        "description": "会话标识符"
      },
      "artifact_path": {
        "type": "string",
        "description": "产物相对路径"
      },
      "content": {
        "type": "string",
        "description": "要写入的文件内容"
      },
      "generate_diff": {
        "type": "boolean",
        "description": "是否生成 diff 并通过 WS 广播 (默认 true)",
        "default": true
      },
      "change_description": {
        "type": "string",
        "description": "变更描述，用于 sync:config_changed 事件"
      }
    },
    "required": ["session_id", "artifact_path", "content"]
  }
}
```

调用的 PipelineService 公开方法:
```python
PipelineService.update_artifact(session_id, artifact_path, content, generate_diff=True, change_description="") -> dict
```

### 4.6 工具5: `request_confirmation` (增强)

```json
{
  "name": "request_confirmation",
  "description": "向用户请求确认。支持两种模式:\n- phase='before': 在步骤执行前请求确认 (Agent提供参数预览)\n- phase='after': 在步骤执行后请求确认 (Agent提供结果预览)\n\nAgent 暂停执行并等待用户响应后才能继续。",
  "input_schema": {
    "type": "object",
    "properties": {
      "session_id": {
        "type": "string",
        "description": "会话标识符"
      },
      "prompt": {
        "type": "string",
        "description": "向用户展示的确认问题"
      },
      "phase": {
        "type": "string",
        "enum": ["before", "after"],
        "description": "确认阶段: before=执行前确认, after=执行后确认 (默认 after)",
        "default": "after"
      },
      "step_name": {
        "type": "string",
        "description": "关联的步骤名称"
      },
      "context": {
        "type": "object",
        "description": "确认上下文。phase=before 时含 params, estimatedDuration, sideEffects; phase=after 时含 result",
        "properties": {
          "params": {
            "type": "object",
            "description": "步骤参数 (phase=before 时使用)"
          },
          "estimatedDuration": {
            "type": "string",
            "description": "预估耗时"
          },
          "sideEffects": {
            "type": "array",
            "items": { "type": "string" },
            "description": "副作用描述列表"
          },
          "result": {
            "type": "object",
            "description": "步骤结果 (phase=after 时使用)"
          }
        }
      },
      "suggestions": {
        "type": "array",
        "items": { "type": "string" },
        "description": "建议的快速回复选项"
      },
      "timeout": {
        "type": "number",
        "description": "确认超时时间 (秒)，默认 1800 (30分钟)",
        "default": 1800
      }
    },
    "required": ["session_id", "prompt"]
  }
}
```

无 PipelineService 调用 — `request_confirmation` 通过 `ConfirmationGate.wait_for_confirmation()` + WS broadcast 实现。

### 4.7 工具6: `inspect_pipeline` (新增)

```json
{
  "name": "inspect_pipeline",
  "description": "内省 Pipeline 的详细状态，包括每个步骤的进度、子步骤状态、产物文件清单和可选耗时统计。比 get_session_state 更细粒度。",
  "input_schema": {
    "type": "object",
    "properties": {
      "session_id": {
        "type": "string",
        "description": "会话标识符"
      },
      "step_name": {
        "type": "string",
        "description": "要检查的步骤名称 (可选，不填则返回所有步骤)",
        "enum": [
          "story_generation",
          "character_extraction",
          "script_writing",
          "storyboard_design",
          "character_portraits",
          "video_rendering"
        ]
      },
      "include_sub_steps": {
        "type": "boolean",
        "description": "是否包含子步骤详情 (默认 true)",
        "default": true
      },
      "include_artifacts": {
        "type": "boolean",
        "description": "是否列出该步骤的产物文件 (默认 true)",
        "default": true
      },
      "include_timings": {
        "type": "boolean",
        "description": "是否包含执行耗时统计 (默认 false)",
        "default": false
      }
    },
    "required": ["session_id"]
  }
}
```

调用的 PipelineService 公开方法:
```python
PipelineService.inspect_pipeline(session_id, step_name=None, include_sub_steps=True, include_artifacts=True, include_timings=False) -> dict
```

### 4.8 更新后的 build_tool_schemas()

```python
# 文件: backend/services/agent_tools.py

def build_tool_schemas() -> list[dict[str, Any]]:
    """Return JSON schema descriptions of all available tools for Anthropic API."""
    return [
        # 1. get_session_state (增强)
        { ... },  # 见 4.2
        # 2. read_artifact (增强)
        { ... },  # 见 4.3
        # 3. run_step (重构)
        { ... },  # 见 4.4
        # 4. update_artifact (增强)
        { ... },  # 见 4.5
        # 5. request_confirmation (增强)
        { ... },  # 见 4.6
        # 6. inspect_pipeline (新增)
        { ... },  # 见 4.7
        # 7-9. ask_user, navigate_to_step, restart_workflow (不变, 保留现有定义)
    ]
```

---

## Section 5: ConfirmationGate组件Props接口

### 5.1 ConfirmationGateBase 组件 (新增共享组件)

```typescript
// 文件: frontend/src/components/shared/ConfirmationGateBase.tsx (新增)

export interface ConfirmationGateBaseProps {
  /** 确认阶段: before=执行前, after=执行后 */
  phase: 'before' | 'after'

  /** 步骤名称 */
  stepName: string

  /** 步骤索引 */
  stepIndex: number

  /** 确认提示消息 */
  message: string

  /** 快速建议选项 */
  suggestions: string[]

  /** 来源面板标识 */
  source: 'WorkArea' | 'ChatPanel'

  /** 确认上下文 (仅 phase='before' 时有效) */
  preStepContext?: PreStepConfirmData

  /** 步骤结果 (仅 phase='after' 时有效) */
  stepResult?: StepResult

  /** 是否正在等待确认 */
  isPending: boolean

  /** 是否禁用 (另一面板正在处理确认时) */
  disabled: boolean

  /** 确认来源 (谁最后操作了确认) */
  lastConfirmationSource: 'WorkArea' | 'ChatPanel' | null

  /** 用户点击确认 */
  onConfirm: () => void

  /** 用户点击修改/拒绝 */
  onModify: (feedback: string, changes?: Record<string, unknown>) => void

  /** 用户点击重新生成 */
  onRegenerate: (feedback?: string) => void

  /** 用户选择建议选项 */
  onSuggestionSelect: (value: string) => void

  /** 用户取消确认 */
  onCancel: () => void
}
```

### 5.2 StepActions Props 扩展

```typescript
// 文件: frontend/src/components/workarea/StepActions.tsx (修改)

export interface StepActionsProps {
  step: WorkflowStep

  // ── V3 新增 props ──────────────────────────────────
  preStepConfirmData: PreStepConfirmData | null
  postStepConfirmData: PostStepConfirmData | null
  lastConfirmationSource: 'WorkArea' | 'ChatPanel' | null
  /** ChatPanel 是否正在确认中 */
  otherPanelConfirming: boolean

  // ── V3 新增回调 ────────────────────────────────────
  onConfirmBefore: () => void
  onRejectBefore: (reply?: string, modifiedParams?: Record<string, unknown>) => void
  onConfirmAfter: () => void
  onModifyAfter: (feedback: string, changes?: Record<string, unknown>) => void
  onRegenerateAfter: (feedback?: string) => void

  // ── 现有 props (保持不变) ───────────────────────────
  onConfirm?: () => void
  onRegenerate?: () => void
  onModify?: () => void
}
```

### 5.3 ConfirmationGateInline 组件 (ChatPanel 内嵌确认)

```typescript
// 文件: frontend/src/components/shared/ConfirmationGateInline.tsx (新增, 已实现 ✅)

export interface ConfirmationGateInlineProps {
  /** 完整确认状态 (来自 syncState.confirmationState) */
  confirmationState: {
    isPending: boolean
    phase: 'before' | 'after' | null
    stepName: string | null
    stepIndex: number | null
    message: string | null
    suggestions: string[]
    confirmedBy: 'user' | 'agent' | null
    timestamp: number | null
    timeoutAt: number | null
  }

  /** 预执行上下文 (phase='before' 时使用) */
  preStepContext: PreStepConfirmData | null

  /** 执行后上下文 (phase='after' 时使用) */
  postStepContext: PostStepConfirmData | null

  /** 来源 */
  lastConfirmationSource: 'WorkArea' | 'ChatPanel' | null

  /** WorkArea 是否正在确认 */
  otherPanelConfirming: boolean

  // ── WS 发送回调 ────────────────────────────────────
  onSendConfirmBefore: (step: string) => void
  onSendRejectBefore: (step: string, reply?: string, modifiedParams?: Record<string, unknown>) => void
  onSendConfirmAfter: (step: string) => void
  onSendModifyAfter: (step: string, changes: Record<string, unknown>, feedback?: string) => void
  onSendRegenerateAfter: (step: string, feedback?: string) => void
  onDismiss: () => void
}
```

### 5.4 AIChatPanel Props 扩展

```typescript
// 文件: frontend/src/components/layout/AIChatPanel.tsx (修改)
// 在现有 AIChatPanelProps 中追加:

type AIChatPanelProps = {
  // ... 所有现有 props 保持不变 ...

  // ── V3 新增: 确认相关 ──────────────────────────────
  confirmationState: SyncState['confirmationState']
  preStepConfirmData: PreStepConfirmData | null
  postStepConfirmData: PostStepConfirmData | null
  lastConfirmationSource: 'WorkArea' | 'ChatPanel' | null
  workAreaConfirming: boolean

  // ── V3 新增: 确认回调 ──────────────────────────────
  onConfirmBefore: (step: string) => void
  onRejectBefore: (step: string, reply?: string, modifiedParams?: Record<string, unknown>) => void
  onConfirmAfter: (step: string) => void
  onModifyAfter: (step: string, changes: Record<string, unknown>, feedback?: string) => void
  onRegenerateAfter: (step: string, feedback?: string) => void
}
```

---

## Section 6: 双向同步数据流

### 6.1 架构全景图

```
┌─────────────────────────────────────────────────────────────────────┐
│                      ViMax V3 双向平权架构                           │
│                    Bidirectional Equal-Rights                        │
└─────────────────────────────────────────────────────────────────────┘

                          ┌──────────────────┐
                          │   Zustand Store  │
                          │  (WorkflowStore) │
                          │                  │
                          │  syncState       │◄── sync:config_changed
                          │   .confirmation  │◄── sync:confirmation_state
                          │   .artifactDiffs │
                          │   .configChanges │
                          │                  │
                          │  preStepConfirm  │◄── step:need_confirm_before
                          │  Data            │
                          │                  │
                          │  postStepConfirm │◄── step:need_confirm
                          │  Data            │
                          │                  │
                          │  lastConfirmatie │   (双向追踪)
                          │  Source          │
                          └───────┬──────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
                    ▼             ▼             ▼
            ┌──────────┐  ┌──────────┐  ┌──────────────┐
            │ WorkArea │  │ChatPanel │  │useSessionWS  │
            │          │  │          │  │   Hook       │
            │StepActions│  │Confirm   │  │              │
            │+Confirm  │  │GateInline│  │ handleWsEvent│
            │ Gate     │  │          │  │ → store      │
            └────┬─────┘  └────┬─────┘  └──────┬───────┘
                 │             │                │
                 │ user:confirm_before          │
                 │ user:reject_before           │
                 │ user:confirm (after)         │
                 │ user:modify                  │
                 └─────────────┬────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   WebSocket Server   │
                    │   ws.py              │
                    │                      │
                    │  _handle_client_event│
                    │   → AgentService     │
                    │   → PipelineService  │
                    └──────────┬───────────┘
                               │
                    ┌──────────┼───────────┐
                    │          │           │
                    ▼          ▼           ▼
            ┌──────────┐ ┌────────┐ ┌──────────┐
            │ Agent    │ │Confirm │ │Pipeline  │
            │ Service  │ │Gate    │ │Service   │
            │          │ │        │ │          │
            │run_step  │ │wait_for│ │run_story │
            │ → before │ │confirm │ │_gen()    │
            │   confirm│ │        │ │run_char  │
            │ → execute│ │resume()│ │_extract()│
            │ → after  │ │        │ │run_script│
            │   confirm│ │cancel()│ │_write()  │
            └──────────┘ └────────┘ └──────────┘
```

### 6.2 预执行确认时序图

```
  Agent           WS Server       WorkArea        ChatPanel       User
    │                 │               │               │               │
    │─tool_run_step──▶│               │               │               │
    │ require_before  │               │               │               │
    │                 │               │               │               │
    │                 │─need_confirm─▶│               │               │
    │                 │ _before       │               │               │
    │                 │               │               │               │
    │                 │──pre_step────▶│               │               │
    │                 │ _context      │               │               │
    │                 │               │               │               │
    │                 │──sync:confirm─▶──────────────▶│               │
    │                 │ _state        │               │               │
    │                 │               │               │               │
    │  [BLOCKED]      │               │               │               │
    │  waiting for    │               │               │               │
    │  confirmation   │               │               │               │
    │                 │               │               │  ◄──clicks──  │
    │                 │               │               │  "确认"       │
    │                 │               │               │               │
    │                 │◀──user:confirm_before──────────│               │
    │                 │               │               │               │
    │                 │──sync:confirm─▶──────────────▶│               │
    │                 │ _state        │               │               │
    │                 │ (confirmed)   │               │               │
    │                 │               │               │               │
    │◀──unblock───────│               │               │               │
    │                 │               │               │               │
    │──step:running──▶│──────────────▶│──────────────▶│               │
    │                 │               │               │               │
    │  [executing]    │               │               │               │
    │                 │               │               │               │
    │──step:completed▶│──────────────▶│──────────────▶│               │
```

### 6.3 双向确认互斥协议

```
规则:
1. 当 WorkArea 的确认UI处于活跃状态 (isPending=true, lastConfirmationSource='WorkArea')
   → ChatPanel 的确认按钮显示为 disabled + "WorkArea正在确认..."
2. 当 ChatPanel 的确认UI处于活跃状态 (isPending=true, lastConfirmationSource='ChatPanel')
   → WorkArea 的确认按钮显示为 disabled + "ChatPanel正在确认..."
3. 确认来源通过 lastConfirmationSource 追踪
4. 超时 (30分钟) 后双方都释放
5. sync:confirmation_state WS 事件确保双方UI状态实时一致

实现伪代码:
  // WorkArea 中:
  const disabled = syncState.confirmationState.isPending &&
                   lastConfirmationSource === 'ChatPanel'

  // ChatPanel 中:
  const disabled = syncState.confirmationState.isPending &&
                   lastConfirmationSource === 'WorkArea'
```

### 6.4 WorkArea 轮询移除 — V2→V3 迁移

```
V2 (当前):
  WorkArea.tsx → setInterval(2000) → GET /api/pipeline/confirm-status
  ├── 脆弱: 与 WS 事件存在竞争条件
  ├── 浪费: 即使 WS 已推送状态仍在轮询
  └── 延迟: 最多 2s 延迟感知状态变化

V3 (目标):
  WorkArea.tsx → WS event handler (handleWsEvent)
  ├── 实时: step:need_confirm → 立即显示确认UI
  ├── 可靠: sync:confirmation_state 保证双面板同步
  └── 节省: 无 HTTP 轮询开销

  保留 REST GET /api/pipeline/confirm-status 仅用于:
  - 页面初次加载时的初始状态恢复 (WS 尚未连接)
  - 调试和健康检查
```

---

## Section 7: 文件级变更清单

### 7.1 新增文件

| # | 文件路径 | 说明 |
|---|---------|------|
| 1 | `web/docs/architecture-v3-design.md` | 本文档 (覆盖已有的草案) |
| 2 | `web/frontend/src/components/shared/ConfirmationGateBase.tsx` | 共享确认UI基础组件 |
| 3 | `web/frontend/src/components/shared/ConfirmationGateInline.tsx` | ChatPanel 内嵌确认组件 ✅ |

### 7.2 删除文件

无。V3 不删除任何现有文件，所有变更均为增量。

### 7.3 修改文件 (按变更量排序)

| # | 文件路径 | 变更类型 | 变更范围 |
|---|---------|---------|---------|
| 1 | `web/backend/services/pipeline_service.py` | **重大重构** | 拆分 `_run_planning` → 4个公开方法 (`run_story_generation`, `run_character_extraction`, `run_script_writing`, `run_storyboard_design`);<br>拆分 `_run_rendering` → 2+N个公开方法 (`run_character_portraits`, `run_video_rendering`, 支持 scene_index/character_index 参数);<br>新增 `get_session_state`, `read_artifact`, `update_artifact`, `inspect_pipeline`, `get_pipeline_progress`, `get_sub_step_status` 公开方法;<br>`_run_planning` / `_run_rendering` 保留为内部方法 (由 `start_planning`/`start_rendering` 调用)，但内部逻辑委托给新的公开方法 |
| 2 | `web/backend/services/agent_tools.py` | **重大重构** | `tool_run_step` 重构: 路由到新公开方法, 支持预确认 (`require_confirm_before`), 支持子步骤 (scene_index/character_index);<br>`tool_get_session_state` 增强: 新增 `include_pipeline_progress`/`include_confirmations` 参数;<br>`tool_read_artifact` 增强: 新增 `offset`/`limit` 参数;<br>`tool_update_artifact` 增强: 新增 `generate_diff`/`change_description` 参数;<br>`tool_request_confirmation` 增强: 新增 `phase`/`step_name`/`context` 参数;<br>新增 `tool_inspect_pipeline`;<br>移除 `tool_skip_step` (合并到 `run_step`);<br>更新 `build_tool_schemas()` 返回所有9个工具的完整 JSON Schema |
| 3 | `web/frontend/src/stores/types.ts` | **重大扩展** | 扩展 `PendingConfirmation` (phase, context, source);<br>新增 `PreStepConfirmData`, `PostStepConfirmData`, `SyncState`, `ConfigChange`, `ArtifactDiff`;<br>新增 `PreStepConfirmContext`, `PipelineProgress`, `ArtifactStatus`, `AgentStateSnapshot`, `ConfirmationSyncState`;<br>更新 `WsServerEvent` (追加4个V3事件) 和 `WsClientEvent` (追加2个V3事件) |
| 4 | `web/frontend/src/stores/workflowStore.ts` | **重大扩展** | `WorkflowState` 新增 `preStepConfirmData`, `postStepConfirmData`, `syncState`, `lastConfirmationSource`;<br>`WorkflowActions` 新增 9 个 actions;<br>`handleWsEvent` 新增 4 个 case;<br>`initialState` 新增默认值 |
| 5 | `web/frontend/src/components/layout/AIChatPanel.tsx` | **重大修改** | 集成 `ConfirmationGateInline` 渲染;<br>新增确认相关 props 和回调;<br>移除 Step1 硬编码关键词提取逻辑 (`extractIdea`/`extractStyle` → WS → Agent → LLM NLP) |
| 6 | `web/frontend/src/components/workarea/WorkArea.tsx` | **重大修改** | **移除** `setInterval` 2秒轮询 (`/api/pipeline/confirm-status`) (lines 40-157);<br>改为纯 WS 事件驱动;<br>集成新确认状态 |
| 7 | `web/frontend/src/components/workarea/StepActions.tsx` | **重大修改** | 新增预确认/后确认相关 `StepActionsProps`;<br>渲染 `ConfirmationGateBase` 组件 |
| 8 | `web/backend/services/agent_service.py` | **中等修改** | `_run_workflow_steps()` 适配新的 `tool_run_step` 返回结构;<br>新增 `handle_confirm_before()` / `handle_reject_before()` 方法;<br>更新 `AGENT_SYSTEM_PROMPT` 描述新的逐步骤确认模式 |
| 9 | `web/backend/services/confirmation_gate.py` | **小修改** | `wait_for_confirmation()` 新增 `phase` 参数;<br>新增 `get_pending_confirmations()` / `is_any_waiting()` 公开方法 |
| 10 | `web/backend/routers/ws.py` | **小修改** | `CLIENT_EVENT_TYPES` 新增 `user:confirm_before`, `user:reject_before`;<br>`_handle_client_event()` 新增两个 case |
| 11 | `web/frontend/src/hooks/useSessionWebSocket.ts` | **小修改** | 新增 `sendConfirmBefore()` / `sendRejectBefore()` 便捷方法 |
| 12 | `web/CLAUDE.md` | **小修改** | 更新架构文档引用 (v2 → v3); 新增铁律 "确认互斥协议" 和 "WS驱动优先" |

---

## Section 8: 向后兼容保证

### 8.1 WS 事件向后兼容

| V2 事件 | V3 状态 | 迁移策略 |
|---------|---------|---------|
| `step:need_confirm` | 保留 + 增强 | `phase` 默认 `"after"`; 现有订阅方无需修改 |
| `step:preparing` | 保留不变 | 无变更 |
| `step:running` | 保留不变 | 无变更 |
| `step:completed` | 保留不变 | 无变更 |
| `step:error` | 保留不变 | 无变更 |
| `pipeline_status` | 保留不变 | Legacy标记; 新代码使用 step:* 系列 |
| `artifact_ready` | 保留不变 | Legacy标记 |
| `pipeline_error` | 保留不变 | Legacy标记 |
| `render_progress` | 保留不变 | Legacy标记 |
| `agent:ask` | 保留不变 | 无变更 |
| `agent:message` | 保留不变 | 无变更 |
| `pipeline:status` | 保留不变 | 无变更 |
| `pipeline:complete` | 保留不变 | 无变更 |
| `connected` | 保留不变 | 无变更 |

### 8.2 REST API 向后兼容

| API 端点 | V3 状态 | 说明 |
|---------|---------|------|
| `POST /api/pipeline/plan` | 保留 | 内部改为调用新的公开方法 (`run_story_generation` + `run_character_extraction` + ...) |
| `POST /api/pipeline/render` | 保留 | 内部改为调用新的公开方法 (`run_character_portraits` + `run_video_rendering`) |
| `GET /api/pipeline/confirm-status` | 保留 | 降级为仅页面初次加载恢复用; 运行时由 WS 驱动 |
| `GET /api/files/{sid}/*` | 不变 | |
| `GET/POST /api/sessions/*` | 不变 | |

### 8.3 Store 向后兼容

- 所有现有 `WorkflowState` 属性**不做删除**，仅追加新属性
- 所有现有 `WorkflowActions` **不做删除**，仅追加新 actions
- `pendingConfirmations` 数组**保留**; `postStepConfirmData` 作为结构化补充，两者共存
- `handleWsEvent` 所有现有 case **保持不变**
- 现有组件 (`StepRunner`, `CreativeSettings`, `StepNavigationBar`) **无需修改** (除非主动集成新功能)

### 8.4 渐进式迁移策略 (5 Phases)

```
Phase 1 (V3.0): 后端重构
  ├── PipelineService 拆分为逐步骤公开方法
  ├── tool_run_step 内部路由到新公开方法
  ├── 现有 _run_planning / _run_rendering 保留 (内部委托给新方法)
  └── 验证: python -m pytest tests/ -x -q

Phase 2 (V3.1): 前端类型扩展
  ├── types.ts 追加 V3 类型
  ├── workflowStore.ts 追加状态/actions/case
  └── 验证: npx tsc --noEmit

Phase 3 (V3.2): WorkArea 去轮询
  ├── 移除 setInterval 2s 轮询
  ├── 改为 WS 事件驱动
  └── 验证: 手动测试完整6步流程

Phase 4 (V3.3): ChatPanel 确认按钮
  ├── 新增 ConfirmationGateInline 组件
  ├── AIChatPanel 集成确认功能
  └── 验证: 在 ChatPanel 中确认步骤, WorkArea 同步更新

Phase 5 (V3.4): AIChatPanel 去硬编码
  ├── 移除 extractIdea/extractStyle 硬编码
  ├── 改为 WS → Agent → LLM NLP 提取
  └── 验证: 输入 "15秒小猫打败老虎" 不再被当成人名
```

---

## Appendix A: 10个缺口与V3解决方案对照表

> 实现状态: 2026-06-23 | feature-v3-upgrade | 12 commits

| # | 缺口 | 严重度 | V3 解决方案 | 实现位置 | 状态 |
|---|------|--------|-----------|---------|------|
| 1 | `tool_run_step` 调用 `_run_planning/_run_rendering` (私有API) | P0 | PipelineService 新增 6+N 个公开方法; `tool_run_step` 路由到公开方法 | `pipeline_service.py` (+6 methods), `agent_tools.py` (重构 run_step) | ✅ Gap #4 |
| 2 | AIChatPanel 硬编码关键词提取 idea/style (绕过 Agent) | P0 | 移除 `extractIdea()`/`extractStyle()` 硬编码; 用户消息通过 WS → Agent → LLM 做 NLP 提取 | `AIChatPanel.tsx` (删除 extractIdea/extractStyle 函数) | ✅ V3 Phase 5 |
| 3 | 无预执行确认机制 (step:need_confirm_before 缺失) | P0 | 新增 `step:need_confirm_before` WS 事件; `request_confirmation(phase='before')`; 新增 `user:confirm_before` / `user:reject_before` | `ws.py` (+2 event types), `types.ts` (+2 WsServerEvent variants), `agent_tools.py` (增强 request_confirmation) | ✅ V3 Phase 1 |
| 4 | `_run_planning/_run_rendering` 批量执行所有子步骤 (不可见) | P1 | 拆分 `_run_planning` → 4 个独立公开方法; 拆分 `_run_rendering` → 2+N per-scene/character 方法 | `pipeline_service.py` (拆分6+) | ✅ agent_tools.py run_step() |
| 5 | ChatPanel 无确认按钮 (违反双向平权) | P1 | 新增 `ConfirmationGateInline` 组件; AIChatPanel 集成确认功能 | `ConfirmationGateInline.tsx` (新增), `AIChatPanel.tsx` (集成) | ✅ B2 + ConfirmationGateInline |
| 6 | WorkArea 和 ChatPanel 无双向同步状态 (lastConfirmationSource 缺失) | P1 | 新增 `syncState` + `lastConfirmationSource`; `sync:confirmation_state` WS 事件驱动双面板同步 | `workflowStore.ts` (+syncState, +lastConfirmationSource), `types.ts` (+SyncState) | ✅ V3 Phase 3-4 |
| 7 | WorkArea 2秒 setInterval 轮询 `/api/pipeline/confirm-status` (脆弱) | P2 | 移除轮询; 改为纯 WS 事件驱动; REST 端点降级为仅页面初始加载恢复 | `WorkArea.tsx` (删除 lines 40-157 轮询代码) | ✅ 之前完成 |
| 8 | 无 artifact diff 状态追踪 (用户修改后无变更记录) | P2 | `update_artifact` 增强自动生成 diff; `sync:config_changed` 广播变更; `ArtifactDiff` 记录历史 | `agent_tools.py` (modify_artifact 用 difflib 生成 unified diff) | ✅ 已实现 |
| 9 | Agent 工具无法内省 Pipeline 状态 (get_session_state 太粗糙) | P2 | 新增 `inspect_pipeline` 工具 (per-step progress, sub-steps, timings); `get_session_state` 增强 (include_pipeline_progress) | `agent_tools.py` (tool_inspect_pipeline, lines 326-486) | ✅ 已实现 |
| 10 | ConfirmationGate 只被 `_run_workflow_steps` 触发 (绕过时无声) | P2 | `request_confirmation` 工具增强 `phase` 参数; 所有确认路径统一经 `ConfirmationGate`; 任何 bypass 产生 `event:error` WS 事件 | `agent_tools.py` (增强 request_confirmation), `confirmation_gate.py` (+is_any_waiting), `agent_service.py` (handle_confirm_before) | ✅ 已实现 |

> **全部 10 个缺口已解决** (10/10)。P0/P1/P2 全覆盖。覆盖率 ≈100%。

---

## Appendix B: 新增 PipelineService 公开方法签名汇总

```python
# 文件: web/backend/services/pipeline_service.py
# V3 新增公开方法 (所有以 _ 开头的方法保留为内部方法)

class PipelineService:

    # ── 现有公开方法 (保留不变) ──────────────────────────
    # async def start_planning(self, request: PipelinePlanRequest) -> PipelineStartResponse
    # async def start_rendering(self, request: PipelineRenderRequest) -> PipelineStartResponse
    # async def cancel_pipeline(self, session_id: str) -> dict
    # def running_session_ids(self) -> list[str]
    # def register_ws(self, session_id, websocket) -> None
    # def unregister_ws(self, session_id, websocket) -> None

    # ── V3 新增: 逐步骤执行 ──────────────────────────────

    async def run_story_generation(
        self,
        session_id: str,
        idea: str,
        style: str,
        user_requirement: str = "",
        progress_callback: Callable | None = None,
    ) -> dict[str, Any]:
        """Execute ONLY story generation. Does NOT run subsequent steps.
        Returns: {"status": "ok", "artifacts": ["idea2video/story.txt"], ...}
        """

    async def run_character_extraction(
        self,
        session_id: str,
        progress_callback: Callable | None = None,
    ) -> dict[str, Any]:
        """Execute ONLY character extraction. Reads story.txt from working dir.
        Returns: {"status": "ok", "artifacts": ["idea2video/characters.json"], ...}
        """

    async def run_script_writing(
        self,
        session_id: str,
        user_requirement: str = "",
        progress_callback: Callable | None = None,
    ) -> dict[str, Any]:
        """Execute ONLY script writing. Reads story.txt + characters.json.
        Returns: {"status": "ok", "artifacts": ["idea2video/script.json"], ...}
        """

    async def run_storyboard_design(
        self,
        session_id: str,
        user_requirement: str = "",
        style: str = "",
        scene_index: int | None = None,
        progress_callback: Callable | None = None,
    ) -> dict[str, Any]:
        """Execute storyboard design.
        If scene_index is None: design ALL scenes.
        If scene_index is provided: design ONLY that scene.
        Returns: {"status": "ok", "artifacts": ["idea2video/scene_N/storyboard.json", ...], ...}
        """

    async def run_character_portraits(
        self,
        session_id: str,
        character_index: int | None = None,
        progress_callback: Callable | None = None,
    ) -> dict[str, Any]:
        """Generate character portraits.
        If character_index is None: generate ALL characters.
        If character_index is provided: generate ONLY that character.
        Returns: {"status": "ok", "portraits": [...], ...}
        """

    async def run_video_rendering(
        self,
        session_id: str,
        scene_index: int | None = None,
        progress_callback: Callable | None = None,
    ) -> dict[str, Any]:
        """Render video.
        If scene_index is None: render ALL scenes.
        If scene_index is provided: render ONLY that scene.
        Returns: {"status": "ok", "video_url": "/api/files/{sid}/...", ...}
        """

    # ── V3 新增: 内省和状态查询 ──────────────────────────

    async def get_session_state(
        self,
        session_id: str,
        include_pipeline_progress: bool = True,
        include_confirmations: bool = True,
    ) -> dict[str, Any]:
        """Return comprehensive session state.
        Returns: {"session": {...}, "pipeline_progress": {...}, "confirmation": {...}}
        """

    async def read_artifact(
        self,
        session_id: str,
        artifact_path: str,
        offset: int | None = None,
        limit: int = 200,
    ) -> str:
        """Read an artifact file, optionally with offset/limit for partial reads.
        Returns: file content as string
        """

    async def update_artifact(
        self,
        session_id: str,
        artifact_path: str,
        content: str,
        generate_diff: bool = True,
        change_description: str = "",
    ) -> dict[str, Any]:
        """Write artifact with automatic diff generation and WS broadcast.
        Returns: {"status": "ok", "diff": {"old": "...", "new": "...", "unified": "..."}}
        """

    async def inspect_pipeline(
        self,
        session_id: str,
        step_name: str | None = None,
        include_sub_steps: bool = True,
        include_artifacts: bool = True,
        include_timings: bool = False,
    ) -> dict[str, Any]:
        """Return detailed introspectable state of the pipeline.
        Returns per-step status, sub-step progress, artifact inventory, optional timing data.
        """

    async def get_pipeline_progress(
        self,
        session_id: str,
    ) -> dict[str, Any]:
        """Return high-level pipeline progress: completed_steps, current_step,
        completion_percent, total_steps.
        """

    async def get_sub_step_status(
        self,
        session_id: str,
        step_name: str,
    ) -> dict[str, Any]:
        """Return detailed sub-step status for storyboard_design or video_rendering.
        Returns per-scene/per-character completion status.
        """
```

---

> **文档版本**: v3.0.0 | **作者**: ViMax Architecture Team | **审查状态**: 待审查
> **后续Agent可以直接依据此文档编码，无需额外设计决策。**
> 所有Section包含完整的代码级定义 (JSON Schema, TypeScript接口, Python方法签名)，可直接复制使用。
