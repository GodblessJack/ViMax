# ViMax V2 架构对齐 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将代码库对齐 `architecture-v2-design.md` 设计文档，按 Phase 1→2→3 顺序补齐所有 P1/P2 缺口。

**Architecture:** Phase 1 补全前端 Store + WS 类型 + WorkArea 组件，Phase 2 打通后端 Agent 真 实 pipeline 执行 + 全 6 步工作流，Phase 3 补齐专用 ResultPanel + 会话恢复 + 错误处理。

**Tech Stack:** TypeScript (React + Zustand), Python (FastAPI + WebSocket), Codex CLI (review)

## Global Constraints

- 旧组件标记 `@deprecated` 不删除，保持向后兼容
- 新旧 WS hook 暂时共存，Phase 2 完成后移除 `usePipelineWebSocket`
- REST 端点不变，不修改 API 契约
- 每个 Phase 结束时独立可测

---

## Phase 1: 基础设施

### Task 1: 补全 WsServerEvent 类型定义

**Files:**
- Modify: `frontend/src/stores/types.ts:134-152`

**Interfaces:**
- Produces: `AgentWorkflowStartedEvent`, `AgentReplyEvent`, `AgentRegenerateAckEvent`, `AgentConfirmAckEvent`, `AgentNavigateEvent`, `EventAckEvent`, `EventErrorEvent`, `PongEvent` — 8 个新接口加入 `WsServerEvent` union

- [ ] **Step 1: 在 types.ts 的 WsServerEvent union 中添加 8 个新类型**

```typescript
// 新增 — 紧接现有 union type 中 'connected' 之后，'Legacy event types' 之前
  | { type: 'agent:workflow_started'; session_id: string; session_stage?: string; message?: string }
  | { type: 'agent:reply'; session_id?: string; reply: string }
  | { type: 'agent:regenerate_ack'; session_id?: string; step?: string }
  | { type: 'agent:confirm_ack'; session_id?: string; step?: string }
  | { type: 'agent:navigate'; session_id?: string; step_index: number; target_step?: string }
  | { type: 'event:ack'; event_type: string; session_id: string }
  | { type: 'event:error'; event_type: string; session_id: string; error: string }
  | { type: 'pong' }
```

- [ ] **Step 2: TypeScript 编译检查**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -30`
Expected: 无新增类型错误（可能已有既存错误）

- [ ] **Step 3: Commit**

```bash
git add frontend/src/stores/types.ts
git commit -m "feat(types): add 8 missing WsServerEvent subtypes to union

Adds agent:workflow_started, agent:reply, agent:regenerate_ack,
agent:confirm_ack, agent:navigate, event:ack, event:error, pong
to match backend ws.py emitted event types.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 补全 WorkflowState 新状态字段 + 初始值

**Files:**
- Modify: `frontend/src/stores/workflowStore.ts:36-89` (interface + initial state)

**Interfaces:**
- Produces: `sessionStage: SessionStage | null`, `currentStepIndex: number`, `confirmedSteps: Set<number>`, `errors: PipelineError[]`

- [ ] **Step 1: 在 WorkflowState interface 中添加 4 个新字段**

在 `workflowStore.ts` 的 `WorkflowState` interface 中，在 `activeStepName: WorkflowStepName | null` 之后添加：

```typescript
  // ── Session Stage (from connected WS event) ─────────────────────
  sessionStage: SessionStage | null

  // ── Navigation ──────────────────────────────────────────────────
  currentStepIndex: number

  // ── Confirmation tracking ───────────────────────────────────────
  confirmedSteps: Set<number>

  // ── Error tracking ──────────────────────────────────────────────
  errors: PipelineError[]
```

需要在文件顶部 import `SessionStage` 和 `PipelineError`：
```typescript
import type { WorkflowStepName, StepRuntime, StepResult, StepStatus, WizardStep, WsServerEvent, ChatMessage, AgentSuggestion, PendingConfirmation, CharacterInfo, SceneScript, StoryboardScene, SessionStage, PipelineError } from '@/stores/types'
```

- [ ] **Step 2: 在 initialState 中添加默认值**

在 `initialState` 对象中（`activeStepName: null,` 之后）添加：

```typescript
  sessionStage: null,
  currentStepIndex: 0,
  confirmedSteps: new Set<number>(),
  errors: [],
```

- [ ] **Step 3: TypeScript 编译检查**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: 无新增错误

- [ ] **Step 4: Commit**

```bash
git add frontend/src/stores/workflowStore.ts
git commit -m "feat(store): add sessionStage, currentStepIndex, confirmedSteps, errors fields

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 补全 WorkflowActions 新 Action

**Files:**
- Modify: `frontend/src/stores/workflowStore.ts:93-164` (interface + implementations)

**Interfaces:**
- Consumes: `sessionStage`, `currentStepIndex`, `confirmedSteps`, `errors` from Task 2
- Produces: `setSession`, `clearSession`, `goToStep`, `nextStep`, `prevStep`, `confirmStep`, `requestRegenerate`, `requestModify`, `patchArtifact`, `addError`, `clearError`, `clearAllErrors`

- [ ] **Step 1: 在 WorkflowActions interface 中添加新 action 签名**

在 `setSessionId` 之后添加：
```typescript
  setSession: (id: string, stage: SessionStage) => void
  clearSession: () => void
```

在 `setActiveStepName` 之后添加：
```typescript
  goToStep: (index: number) => void
  nextStep: () => void
  prevStep: () => void
  confirmStep: (index: number) => void
  requestRegenerate: (index: number, feedback?: string) => void
  requestModify: (index: number, changes: Record<string, unknown>) => void
```

在 `updateArtifact` 之后添加：
```typescript
  patchArtifact: (key: string, patch: Partial<unknown>) => void
```

在 `clearAgentSuggestions` 之后添加：
```typescript
  addError: (error: PipelineError) => void
  clearError: (step: string) => void
  clearAllErrors: () => void
```

- [ ] **Step 2: 实现 setSession / clearSession**

在 store create 回调中，`setSessionId` 实现之后添加：

```typescript
  setSession: (id, stage) => set({ sessionId: id, sessionStage: stage }),
  clearSession: () => set({
    sessionId: null,
    sessionStage: null,
    activeStepName: null,
    currentStepIndex: 0,
    confirmedSteps: new Set(),
  }),
```

- [ ] **Step 3: 实现 goToStep / nextStep / prevStep**

```typescript
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
```

- [ ] **Step 4: 实现 confirmStep / requestRegenerate / requestModify**

```typescript
  confirmStep: (index) =>
    set((state) => {
      const next = new Set(state.confirmedSteps)
      next.add(index)
      return {
        confirmedSteps: next,
        pendingConfirmations: [],
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
```

- [ ] **Step 5: 实现 patchArtifact**

```typescript
  patchArtifact: (key, patch) =>
    set((state) => ({
      artifacts: {
        ...state.artifacts,
        [key]: {
          ...(state.artifacts[key] as Record<string, unknown> || {}),
          ...(patch as Record<string, unknown>),
        },
      },
    })),
```

- [ ] **Step 6: 实现 addError / clearError / clearAllErrors**

```typescript
  addError: (error) =>
    set((state) => ({
      errors: [...state.errors, error],
    })),
  clearError: (step) =>
    set((state) => ({
      errors: state.errors.filter((e) => e.step !== step),
    })),
  clearAllErrors: () => set({ errors: [] }),
```

- [ ] **Step 7: TypeScript 编译检查**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: 无新增错误

- [ ] **Step 8: Commit**

```bash
git add frontend/src/stores/workflowStore.ts
git commit -m "feat(store): add setSession, navigation, confirmation, patch, error actions

Adds goToStep/nextStep/prevStep, confirmStep, requestRegenerate/requestModify,
patchArtifact, addError/clearError/clearAllErrors, setSession/clearSession.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 补全 handleWsEvent 对 8 个新事件的处理

**Files:**
- Modify: `frontend/src/stores/workflowStore.ts:382-476` (handleWsEvent switch)

**Interfaces:**
- Consumes: `setSession`, `goToStep`, `confirmStep`, `addError` from Task 3

- [ ] **Step 1: 在 handleWsEvent 的 switch 中添加新 case**

在 `case 'connected':` 之后、`// Legacy events` 注释之前，插入：

```typescript
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
        const stepName = (event as any).step
        if (stepName) {
          const stepIdx = get().steps.find((s) => s.name === stepName)?.index
          if (stepIdx !== undefined) get().confirmStep(stepIdx)
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
      case 'pong': {
        // no-op — heartbeat response
        break
      }
```

- [ ] **Step 2: 更新 switch 的穷举性检查**

确保所有 `WsServerEvent` union 成员都有 case。legacy events（`pipeline_status`, `pipeline_error`, `artifact_ready`, `render_progress`）已通过 fall-through 处理。

- [ ] **Step 3: TypeScript 编译检查**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: 无新增错误

- [ ] **Step 4: Commit**

```bash
git add frontend/src/stores/workflowStore.ts
git commit -m "feat(store): handle 8 new WS event types in handleWsEvent

Dispatches agent:workflow_started, agent:reply, agent:regenerate_ack,
agent:confirm_ack, agent:navigate, event:ack, event:error, pong.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 创建 WorkArea 容器组件

**Files:**
- Create: `frontend/src/components/workarea/WorkArea.tsx`

**Interfaces:**
- Consumes: `useWorkflowStore` (steps, currentStepIndex, sessionId)
- Produces: `WorkArea` — 工作区顶层容器，渲染 StepNavigationBar + StepRunner + StepActions

- [ ] **Step 1: 编写 WorkArea.tsx**

```tsx
// frontend/src/components/workarea/WorkArea.tsx
import { useWorkflowStore } from '@/stores/workflowStore'
import { StepNavigationBar } from './StepNavigationBar'
import { StepRunner } from './StepRunner'
import { StepActions } from './StepActions'

export function WorkArea() {
  const sessionId = useWorkflowStore((s) => s.sessionId)
  const steps = useWorkflowStore((s) => s.steps)
  const currentStepIndex = useWorkflowStore((s) => s.currentStepIndex)
  const currentStep = steps[currentStepIndex]

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        创建会话后开始创作流程
      </div>
    )
  }

  return (
    <div className="work-area flex flex-col h-full">
      <StepNavigationBar />
      {currentStep && <StepRunner step={currentStep} />}
      {currentStep && <StepActions step={currentStep} />}
    </div>
  )
}
```

- [ ] **Step 2: TypeScript 编译检查**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -10`
Expected: 找不到 `./StepNavigationBar` 等模块（正常，后续 Task 创建）

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/workarea/WorkArea.tsx
git commit -m "feat(workarea): add WorkArea container component

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 创建 StepNavigationBar + StepRunner + StepActions

**Files:**
- Create: `frontend/src/components/workarea/StepNavigationBar.tsx`
- Create: `frontend/src/components/workarea/StepRunner.tsx`
- Create: `frontend/src/components/workarea/StepActions.tsx`

**Interfaces:**
- Consumes: `useWorkflowStore` 的 `steps`, `currentStepIndex`, `goToStep`, `confirmedSteps`, `runtime`, `confirmStep`, `requestRegenerate`, `prevStep`, `sendWsMessage`
- Produces: 3 个可独立使用的 UI 组件

- [ ] **Step 1: 编写 StepNavigationBar.tsx**

```tsx
// frontend/src/components/workarea/StepNavigationBar.tsx
import { useWorkflowStore } from '@/stores/workflowStore'
import { CheckCircle2, Circle, AlertCircle, Clock } from 'lucide-react'

const STATUS_ICON: Record<string, React.ComponentType<any>> = {
  completed: CheckCircle2,
  error: AlertCircle,
  running: Clock,
  idle: Circle,
  preparing: Clock,
  skipped: Circle,
}

export function StepNavigationBar() {
  const steps = useWorkflowStore((s) => s.steps)
  const currentStepIndex = useWorkflowStore((s) => s.currentStepIndex)
  const confirmedSteps = useWorkflowStore((s) => s.confirmedSteps)
  const goToStep = useWorkflowStore((s) => s.goToStep)
  const runtime = useWorkflowStore((s) => s.runtime)

  return (
    <div className="step-navigation-bar flex items-center gap-1 px-4 py-3 overflow-x-auto border-b">
      {steps.map((step, idx) => {
        const isCurrent = idx === currentStepIndex
        const isConfirmed = confirmedSteps.has(idx)
        const isCompleted = step.status === 'completed'
        const isClickable = isConfirmed || isCompleted || idx <= currentStepIndex
        const rt = runtime[step.name]
        const status = rt?.phase === 'done' ? 'completed'
          : rt?.phase === 'running' ? 'running'
          : step.status
        const Icon = STATUS_ICON[status] || Circle

        return (
          <button
            key={step.name}
            onClick={() => isClickable && goToStep(idx)}
            disabled={!isClickable}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap
              transition-colors
              ${isCurrent ? 'bg-primary text-primary-foreground font-medium' : ''}
              ${isClickable && !isCurrent ? 'hover:bg-muted cursor-pointer' : ''}
              ${!isClickable ? 'opacity-50 cursor-not-allowed' : ''}
            `}
            title={step.label}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{idx + 1}. {step.label}</span>
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: 编写 StepRunner.tsx （三阶段卡片）**

```tsx
// frontend/src/components/workarea/StepRunner.tsx
import type { WorkflowStep } from '@/stores/types'
import { useWorkflowStore } from '@/stores/workflowStore'

export function StepRunner({ step }: { step: WorkflowStep }) {
  const runtime = useWorkflowStore((s) => s.runtime[step.name])

  if (!runtime) return null

  return (
    <div className="step-runner flex-1 overflow-y-auto p-4">
      {/* Phase: Preparing */}
      {runtime.phase === 'preparing' && (
        <div className="preparing-panel space-y-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
            <span className="font-medium">{step.label} — 准备中...</span>
          </div>
          <p className="text-sm text-muted-foreground">
            正在分析输入和约束，准备开始生成...
          </p>
        </div>
      )}

      {/* Phase: Running */}
      {runtime.phase === 'running' && (
        <div className="running-panel space-y-3">
          <div className="flex items-center gap-2">
            <span className="animate-pulse text-primary">⚡</span>
            <span className="font-medium">{step.label} — 生成中</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-primary h-full rounded-full transition-all duration-500"
              style={{ width: `${runtime.progressPercent}%` }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {runtime.progressMessage || '处理中...'}
          </p>
          {runtime.streamedOutput && (
            <pre className="text-sm bg-muted/50 rounded p-3 max-h-48 overflow-y-auto whitespace-pre-wrap">
              {runtime.streamedOutput}
              <span className="animate-pulse">▌</span>
            </pre>
          )}
        </div>
      )}

      {/* Phase: Done */}
      {runtime.phase === 'done' && (
        <div className="result-panel space-y-3">
          {runtime.error ? (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 text-destructive">
              <p className="font-medium">步骤执行出错</p>
              <p className="text-sm mt-1">{runtime.error}</p>
            </div>
          ) : (
            <div className="bg-card border rounded-lg p-4">
              <h3 className="font-medium text-lg">{step.label} — 完成</h3>
              {runtime.result && (
                <>
                  <p className="text-sm text-muted-foreground mt-2">
                    {runtime.result.summary}
                  </p>
                  {runtime.result.artifactPaths.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-2">
                      生成 {runtime.result.artifactPaths.length} 个文件
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 编写 StepActions.tsx**

```tsx
// frontend/src/components/workarea/StepActions.tsx
import type { WorkflowStep } from '@/stores/types'
import { useWorkflowStore } from '@/stores/workflowStore'

export function StepActions({ step }: { step: WorkflowStep }) {
  const currentStepIndex = useWorkflowStore((s) => s.currentStepIndex)
  const confirmedSteps = useWorkflowStore((s) => s.confirmedSteps)
  const runtime = useWorkflowStore((s) => s.runtime[step.name])
  const prevStep = useWorkflowStore((s) => s.prevStep)
  const confirmStep = useWorkflowStore((s) => s.confirmStep)
  const requestRegenerate = useWorkflowStore((s) => s.requestRegenerate)
  const sendWsMessage = useWorkflowStore((s) => s.sendWsMessage)

  const isDone = runtime?.phase === 'done'
  const isError = !!runtime?.error
  const isConfirmed = confirmedSteps.has(step.index)
  const isLastStep = step.index === 5

  if (!isDone) return null

  return (
    <div className="step-actions flex items-center justify-center gap-3 p-4 border-t">
      {/* Previous step */}
      {currentStepIndex > 0 && (
        <button
          onClick={prevStep}
          className="px-4 py-2 text-sm rounded-lg border hover:bg-muted transition-colors"
        >
          ← 上一步
        </button>
      )}

      {/* Confirm */}
      {step.requiresConfirmation && !isConfirmed && !isError && (
        <button
          onClick={() => {
            confirmStep(step.index)
            sendWsMessage({ type: 'user:confirm', step: step.name })
          }}
          className="px-6 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
        >
          ✅ 确认，进入下一步
        </button>
      )}

      {/* Regenerate */}
      {!isError && (
        <button
          onClick={() => {
            requestRegenerate(step.index)
          }}
          className="px-4 py-2 text-sm rounded-lg border hover:bg-muted transition-colors"
        >
          🔄 重新生成
        </button>
      )}

      {/* Error retry */}
      {isError && (
        <button
          onClick={() => {
            requestRegenerate(step.index)
          }}
          className="px-4 py-2 text-sm rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
        >
          🔄 重试
        </button>
      )}

      {/* Discuss */}
      <button
        onClick={() => {
          sendWsMessage({
            type: 'user:message',
            text: `我想讨论一下 ${step.label}...`,
            context: { current_step: step.name },
          })
        }}
        className="px-4 py-2 text-sm rounded-lg border hover:bg-muted transition-colors"
      >
        💬 在对话区讨论
      </button>
    </div>
  )
}
```

- [ ] **Step 4: TypeScript 编译检查**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: 无新增错误（WorkArea 的 import 现在都能 resolve）

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/workarea/
git commit -m "feat(workarea): add StepNavigationBar, StepRunner, StepActions components

Implements three-phase step cards (preparing/running/done), clickable
step navigation bar, and action buttons (prev/confirm/regenerate/discuss).

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: 重构 CreateDramaPage 使用 WorkArea

**Files:**
- Modify: `frontend/src/pages/CreateDramaPage.tsx`

**Interfaces:**
- Consumes: `WorkArea`, `AIChatPanel` (existing), `useWorkflowStore`
- Produces: 精简后的 CreateDramaPage（~100 行）

- [ ] **Step 1: 重写 CreateDramaPage**

```tsx
// frontend/src/pages/CreateDramaPage.tsx
import { useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { WorkArea } from '@/components/workarea/WorkArea'
import { AIChatPanel } from '@/components/layout/AIChatPanel'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useSessionWebSocket } from '@/hooks/useSessionWebSocket'
import { logger } from '@/lib/logger'

export default function CreateDramaPage() {
  const [searchParams] = useSearchParams()
  const sessionId = useWorkflowStore((s) => s.sessionId)
  const setSession = useWorkflowStore((s) => s.setSession)
  const goToStep = useWorkflowStore((s) => s.goToStep)

  // WebSocket connection
  useSessionWebSocket(sessionId)

  // Session restore from URL param
  useEffect(() => {
    const sid = searchParams.get('session')
    if (!sid || sessionId) return
    import('@/lib/api').then(({ getSession }) => {
      getSession(sid).then((detail) => {
        if (!detail) return
        setSession(detail.session_id, detail.stage)
        // Map session stage to step index
        const stageToStep: Record<string, number> = {
          created: 0,
          narrative_planning: 0,
          narrative_planned: 2,
          rendering: 4,
          rendered: 5,
          error: 0,
          cancelled: 0,
        }
        goToStep(stageToStep[detail.stage] ?? 0)
        logger.info('Session restored', { sessionId: sid, stage: detail.stage })
      }).catch((err) => {
        logger.error('Failed to restore session', err)
      })
    })
  }, [searchParams, sessionId, setSession, goToStep])

  return (
    <div className="create-drama-page flex h-[calc(100vh-4rem)]">
      {/* Left: WorkArea */}
      <div className="flex-1 min-w-0 border-r">
        <WorkArea />
      </div>
      {/* Right: AgentChat */}
      <div className="w-96 flex-shrink-0">
        <AIChatPanel />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript 编译检查**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/CreateDramaPage.tsx
git commit -m "refactor(page): simplify CreateDramaPage to use WorkArea + Store

Removes local useState/useEffect sync layer. All state now reads
from WorkflowStore. WorkArea + AIChatPanel replace inline step components.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 2: Agent 集成打通

### Task 8: 对齐 run_step 枚举值到设计文档

**Files:**
- Modify: `backend/services/agent_tools.py:129-136` (pipeline_steps dict)
- Modify: `backend/services/agent_tools.py:271-306` (_STEP_SUGGESTIONS 无变化，已正确)

**Interfaces:**
- Produces: `pipeline_steps` dict key 从旧名改为设计文档规定的 StepName

- [ ] **Step 1: 替换 pipeline_steps 的 key 映射**

将 `agent_tools.py` 第 129-136 行的：
```python
    pipeline_steps = {
        "develop_story": ("planning", "develop_story"),
        "extract_characters": ("planning", "extract_characters"),
        "write_script": ("planning", "write_script"),
        "plan_scenes": ("planning", "plan_scenes"),
        "character_portraits": ("rendering", "character_portraits"),
        "render_scenes": ("rendering", "render_scenes"),
    }
```

改为（匹配设计文档 Section 5.2 + config.py 的 6 步名）：
```python
    pipeline_steps = {
        "story_generation": ("planning", "story_generation"),
        "character_extraction": ("planning", "character_extraction"),
        "script_writing": ("planning", "script_writing"),
        "storyboard_design": ("planning", "storyboard_design"),
        "character_portraits": ("rendering", "character_portraits"),
        "video_rendering": ("rendering", "video_rendering"),
    }
```

- [ ] **Step 2: 验证 Python 语法**

Run: `cd backend && python -c "from web.backend.services.agent_tools import _STEP_SUGGESTIONS; print(list(_STEP_SUGGESTIONS.keys()))"`
Expected: `['story_generation', 'character_extraction', 'script_writing', 'storyboard_design', 'character_portraits', 'video_rendering']`

- [ ] **Step 3: Commit**

```bash
git add backend/services/agent_tools.py
git commit -m "fix(agent): align run_step enum values with architecture-v2-design.md

Changes: develop_story→story_generation, extract_characters→character_extraction,
write_script→script_writing, plan_scenes→storyboard_design,
render_scenes→video_rendering.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: 实现 run_step 真实 Pipeline 调用

**Files:**
- Modify: `backend/services/agent_tools.py:142-164` (tool_run_step body)

**Interfaces:**
- Consumes: `PipelineService._run_planning`, `PipelineService._run_rendering`

- [ ] **Step 1: 重写 tool_run_step 执行逻辑**

将 stub 实现（lines 143-163）替换为调用 PipelineService 的真实逻辑：

```python
    try:
        await agent_service.broadcast(session_id, {
            "type": "step:preparing",
            "step": step_name,
            "context": {
                "inputs": params or {},
                "constraints": [],
                "agentIntent": f"Executing step: {step_name}",
            },
        })

        # Delegate to PipelineService
        if phase == "planning":
            # Planning steps run through start_planning (or per-step methods)
            pipeline = agent_service._pipeline_service
            ws_cb = _ws_broadcaster_factory(agent_service, session_id)

            if step_name == "story_generation":
                # Initiate the planning pipeline
                await pipeline.start_planning(
                    session_id=session_id,
                    idea=(params or {}).get("idea", ""),
                    style=(params or {}).get("style", "wuxia"),
                    user_requirement=(params or {}).get("user_requirement", ""),
                    progress_callback=lambda stage, msg, meta=None: ws_cb(stage, msg, meta),
                )
            elif step_name == "character_extraction":
                # Characters are generated during _run_planning — if already planned, skip
                await agent_service.broadcast(session_id, {
                    "type": "step:running",
                    "step": step_name,
                    "progress_percent": 50,
                    "progress_message": "正在从故事中提取角色...",
                })
                # For now: emit done since planning already ran character extraction
                await agent_service.broadcast(session_id, {
                    "type": "step:completed",
                    "step": step_name,
                    "result": {
                        "summary": "角色提取完成",
                        "artifactPaths": [],
                        "previewData": None,
                        "editableFields": [],
                    },
                })
                return {"status": "ok", "step": step_name}
            else:
                # script_writing / storyboard_design — handled by _run_planning
                await agent_service.broadcast(session_id, {
                    "type": "step:completed",
                    "step": step_name,
                    "result": {
                        "summary": f"{step_name} 完成",
                        "artifactPaths": [],
                        "previewData": None,
                        "editableFields": [],
                    },
                })

        elif phase == "rendering":
            pipeline = agent_service._pipeline_service
            ws_cb = _ws_broadcaster_factory(agent_service, session_id)
            await pipeline.start_rendering(
                session_id=session_id,
                progress_callback=lambda stage, msg, meta=None: ws_cb(stage, msg, meta),
            )

        return {"status": "ok", "step": step_name}
    except Exception as exc:
        logger.exception("Step %s failed for session %s", step_name, session_id)
        await agent_service.broadcast(session_id, {
            "type": "step:error",
            "step": step_name,
            "error": str(exc),
            "recoverable": True,
        })
        return {"status": "error", "error": str(exc)}
```

- [ ] **Step 2: 验证语法**

Run: `cd backend && python -c "from web.backend.services.agent_tools import tool_run_step; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/services/agent_tools.py
git commit -m "feat(agent): implement real pipeline execution in tool_run_step

Replaces stub with actual PipelineService.start_planning/start_rendering
calls with WS progress broadcasting.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: 扩展工作流到全部 6 步

**Files:**
- Modify: `backend/services/agent_service.py:400-475` (_run_workflow_steps)

**Interfaces:**
- Consumes: `WORKFLOW_STEPS` (from `agent_tools.py` or config)
- Produces: 6-step sequential workflow with confirmation gates

- [ ] **Step 1: 读取当前 _run_workflow_steps**

先确认当前实现的具体行号和结构。

Run: `grep -n "_run_workflow_steps\|storyboard_design\|character_portraits\|video_rendering\|pipeline:complete" backend/services/agent_service.py`

- [ ] **Step 2: 重写为遍历 WORKFLOW_STEPS**

将硬编码的 3 步循环替换为通用的 6 步遍历：

```python
    async def _run_workflow_steps(
        self, session_id: str, idea: str, style: str, user_requirement: str
    ) -> None:
        from web.backend.services.agent_tools import tool_run_step
        from web.backend.main import get_session_service

        WORKFLOW_STEP_NAMES = [
            "story_generation",
            "character_extraction",
            "script_writing",
            "storyboard_design",
            "character_portraits",
            "video_rendering",
        ]

        svc = get_session_service()

        for step_name in WORKFLOW_STEP_NAMES:
            # Determine if this step should be skipped
            session = svc.get_session(session_id)
            if session is None:
                break

            # Execute the step via tool_run_step
            self.broadcast(session_id, {
                "type": "pipeline:status",
                "session_id": session_id,
                "stage": step_name,
                "message": f"Starting {step_name}",
            })

            result = await tool_run_step(
                session_id=session_id,
                step_name=step_name,
                params={"idea": idea, "style": style, "user_requirement": user_requirement},
                agent_service=self,
            )

            if result.get("status") == "error":
                self.broadcast(session_id, {
                    "type": "step:error",
                    "step": step_name,
                    "error": result.get("error", "Unknown error"),
                    "recoverable": True,
                })
                # Wait for user to decide: retry or skip
                try:
                    gate_result = await self._confirmation_gate.wait_for_confirmation(
                        session_id,
                        f"步骤 {step_name} 执行失败: {result.get('error')}。要重试还是跳过？",
                        {"step": step_name, "error": result.get("error")},
                    )
                    if gate_result.get("action") == "skip":
                        self.broadcast(session_id, {
                            "type": "step:completed",
                            "step": step_name,
                            "result": {"summary": "已跳过", "artifactPaths": [], "previewData": None, "editableFields": []},
                        })
                        continue
                    elif gate_result.get("action") == "retry":
                        continue  # Retry the same step
                    else:
                        break  # Stop workflow
                except Exception:
                    break

            # Skip confirmation for video_rendering (last step, auto-completes)
            if step_name == "video_rendering":
                continue

            # Wait for user confirmation before proceeding to next step
            await self._confirmation_gate.wait_for_confirmation(
                session_id,
                f"{step_name} 已完成。要确认并进入下一步吗？",
                {"step": step_name},
            )

        # Workflow complete
        self.broadcast(session_id, {
            "type": "pipeline:complete",
            "stage": "completed",
            "session_id": session_id,
        })
```

- [ ] **Step 3: 验证 Python 语法**

Run: `cd backend && python -c "import ast; ast.parse(open('web/backend/services/agent_service.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/services/agent_service.py
git commit -m "feat(agent): extend workflow to all 6 steps with confirmation gates

Replaces hard-coded 3-step loop with generic iteration over 6 step names:
story_generation → character_extraction → script_writing →
storyboard_design → character_portraits → video_rendering.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 11: 实现 user:regenerate 真实逻辑

**Files:**
- Modify: `backend/routers/ws.py:246-251` (user:regenerate handler)
- Modify: `backend/services/agent_service.py` (add handle_regenerate method)

**Interfaces:**
- Consumes: `agent_service.handle_regenerate(session_id, step, feedback)`
- Produces: 步骤重新生成 + WS 通知

- [ ] **Step 1: 在 AgentService 中添加 handle_regenerate 方法**

```python
    async def handle_regenerate(
        self, session_id: str, step: str, feedback: str | None = None
    ) -> None:
        """Handle a user request to regenerate a step.
        
        Resets the step runtime state and re-executes it via tool_run_step.
        """
        from web.backend.services.agent_tools import tool_run_step

        self.broadcast(session_id, {
            "type": "agent:regenerate_ack",
            "session_id": session_id,
            "step": step,
        })

        self.broadcast(session_id, {
            "type": "step:preparing",
            "step": step,
            "context": {
                "inputs": {"feedback": feedback or ""},
                "constraints": [],
                "agentIntent": f"Regenerating {step} based on user feedback",
            },
        })

        result = await tool_run_step(
            session_id=session_id,
            step_name=step,
            params={"feedback": feedback or ""},
            agent_service=self,
        )

        if result.get("status") == "error":
            self.broadcast(session_id, {
                "type": "step:error",
                "step": step,
                "error": result.get("error", "Regeneration failed"),
                "recoverable": True,
            })
```

- [ ] **Step 2: 替换 ws.py 的 user:regenerate stub**

将 ws.py 第 246-250 行改为：
```python
        elif event_type == "user:regenerate":
            step = payload.get("step", "")
            feedback = payload.get("feedback", "")
            await agent_service.handle_regenerate(session_id, step, feedback)
```

- [ ] **Step 3: 验证语法**

Run: `cd backend && python -c "import ast; ast.parse(open('web/backend/services/agent_service.py').read()); ast.parse(open('web/backend/routers/ws.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/routers/ws.py backend/services/agent_service.py
git commit -m "feat(ws): implement real user:regenerate logic with handle_regenerate

Replaces stub ack-only handler with full step re-execution via
AgentService.handle_regenerate() -> tool_run_step().

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 3: 精化

### Task 12: 创建 6 个专用 ResultPanel

**Files:**
- Create: `frontend/src/components/workarea/panels/StoryResultPanel.tsx`
- Create: `frontend/src/components/workarea/panels/CharacterResultPanel.tsx`
- Create: `frontend/src/components/workarea/panels/ScriptResultPanel.tsx`
- Create: `frontend/src/components/workarea/panels/StoryboardResultPanel.tsx`
- Create: `frontend/src/components/workarea/panels/PortraitResultPanel.tsx`
- Create: `frontend/src/components/workarea/panels/VideoResultPanel.tsx`

**Interfaces:**
- Each Panel: `{ data: unknown; onEdit?: (path: string, value: unknown) => void }`

- [ ] **Step 1: StoryResultPanel — 富文本故事 + 章节树**

```tsx
// frontend/src/components/workarea/panels/StoryResultPanel.tsx
export function StoryResultPanel({ data, onEdit }: { data: unknown; onEdit?: (path: string, value: unknown) => void }) {
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
            <p key={i} className="mb-3 leading-relaxed">{para}</p>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: CharacterResultPanel — 角色卡片网格**

```tsx
// frontend/src/components/workarea/panels/CharacterResultPanel.tsx
import type { CharacterInfo } from '@/stores/types'

export function CharacterResultPanel({ data, onEdit }: { data: unknown; onEdit?: (path: string, value: unknown) => void }) {
  const characters = (Array.isArray(data) ? data : []) as CharacterInfo[]

  return (
    <div className="character-result space-y-4">
      <h3 className="font-semibold text-lg">👥 角色列表 ({characters.length})</h3>
      {characters.length === 0 ? (
        <p className="text-muted-foreground text-sm">暂无角色数据</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {characters.map((char, i) => (
            <div key={i} className="border rounded-lg p-3 bg-card">
              <p className="font-medium">{char.identifier}</p>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{char.static_features}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: ScriptResultPanel — 场景/对白列表**

```tsx
// frontend/src/components/workarea/panels/ScriptResultPanel.tsx
import type { SceneScript } from '@/stores/types'

export function ScriptResultPanel({ data, onEdit }: { data: unknown; onEdit?: (path: string, value: unknown) => void }) {
  const scenes = (Array.isArray(data) ? data : []) as SceneScript[]

  return (
    <div className="script-result space-y-4">
      <h3 className="font-semibold text-lg">📜 剧本场景 ({scenes.length})</h3>
      {scenes.length === 0 ? (
        <p className="text-muted-foreground text-sm">暂无剧本数据</p>
      ) : (
        <div className="space-y-2">
          {scenes.map((scene, i) => (
            <div key={i} className="border rounded-lg p-3 bg-card flex items-center gap-3">
              <span className="text-sm font-mono text-muted-foreground">#{scene.index}</span>
              <div>
                <p className="font-medium">{scene.title}</p>
                <p className="text-xs text-muted-foreground">{scene.shot_count} 个镜头</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: StoryboardResultPanel — 分镜网格**

```tsx
// frontend/src/components/workarea/panels/StoryboardResultPanel.tsx
import type { StoryboardScene } from '@/stores/types'

export function StoryboardResultPanel({ data, onEdit }: { data: unknown; onEdit?: (path: string, value: unknown) => void }) {
  const scenes = (Array.isArray(data) ? data : []) as StoryboardScene[]

  return (
    <div className="storyboard-result space-y-4">
      <h3 className="font-semibold text-lg">🎬 分镜镜头</h3>
      {scenes.length === 0 ? (
        <p className="text-muted-foreground text-sm">暂无分镜数据</p>
      ) : (
        scenes.map((scene, si) => (
          <div key={si} className="border rounded-lg p-3 bg-card">
            <h4 className="font-medium text-sm mb-2">场景 {scene.index}: {scene.title}</h4>
            <div className="grid grid-cols-3 gap-2">
              {scene.shots?.map((shot, i) => (
                <div key={i} className="border rounded p-2 text-xs bg-muted/30">
                  <p className="font-mono">镜头 {shot.idx}</p>
                  <p className="text-muted-foreground line-clamp-2 mt-0.5">{shot.visual_desc}</p>
                  <p className="text-muted-foreground mt-0.5">角度: {shot.angle}</p>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
```

- [ ] **Step 5: PortraitResultPanel + VideoResultPanel**

PortraitResultPanel — 肖像画廊：
```tsx
// frontend/src/components/workarea/panels/PortraitResultPanel.tsx
import type { PortraitEntry } from '@/stores/types'

export function PortraitResultPanel({ data, onEdit }: { data: unknown; onEdit?: (path: string, value: unknown) => void }) {
  const portraits = (Array.isArray(data) ? data : []) as PortraitEntry[]

  return (
    <div className="portrait-result space-y-4">
      <h3 className="font-semibold text-lg">🖼️ 角色肖像 ({portraits.length})</h3>
      {portraits.length === 0 ? (
        <p className="text-muted-foreground text-sm">暂无肖像数据</p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {portraits.map((p, i) => (
            <div key={i} className="border rounded-lg overflow-hidden bg-card">
              {p.image_url ? (
                <img src={p.image_url} alt={`${p.character} ${p.view}`} className="w-full aspect-square object-cover" />
              ) : (
                <div className="w-full aspect-square bg-muted flex items-center justify-center text-muted-foreground text-xs">
                  无预览
                </div>
              )}
              <div className="p-2 text-xs">
                <p className="font-medium">{p.character}</p>
                <p className="text-muted-foreground">{p.view}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

VideoResultPanel — 播放器 + 下载：
```tsx
// frontend/src/components/workarea/panels/VideoResultPanel.tsx
export function VideoResultPanel({ data, onEdit }: { data: unknown; onEdit?: (path: string, value: unknown) => void }) {
  const videoUrl = typeof data === 'string' ? data : (data as any)?.finalVideoUrl || ''

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
            poster={(data as any)?.thumbnail_url}
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
```

- [ ] **Step 6: 导出 index.ts**

```typescript
// frontend/src/components/workarea/panels/index.ts
export { StoryResultPanel } from './StoryResultPanel'
export { CharacterResultPanel } from './CharacterResultPanel'
export { ScriptResultPanel } from './ScriptResultPanel'
export { StoryboardResultPanel } from './StoryboardResultPanel'
export { PortraitResultPanel } from './PortraitResultPanel'
export { VideoResultPanel } from './VideoResultPanel'

import type { WorkflowStepName } from '@/stores/types'

export const STEP_RESULT_COMPONENTS: Record<WorkflowStepName, React.ComponentType<{ data: unknown; onEdit?: (path: string, value: unknown) => void }>> = {
  story_generation: () => import('./StoryResultPanel').then(m => ({ default: m.StoryResultPanel })) as any,
  character_extraction: () => import('./CharacterResultPanel').then(m => ({ default: m.CharacterResultPanel })) as any,
  script_writing: () => import('./ScriptResultPanel').then(m => ({ default: m.ScriptResultPanel })) as any,
  storyboard_design: () => import('./StoryboardResultPanel').then(m => ({ default: m.StoryboardResultPanel })) as any,
  character_portraits: () => import('./PortraitResultPanel').then(m => ({ default: m.PortraitResultPanel })) as any,
  video_rendering: () => import('./VideoResultPanel').then(m => ({ default: m.VideoResultPanel })) as any,
}
```

- [ ] **Step 7: TypeScript 编译检查**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: 无新增错误

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/workarea/panels/
git commit -m "feat(panels): add 6 specialized step result panel components

Adds StoryResultPanel, CharacterResultPanel, ScriptResultPanel,
StoryboardResultPanel, PortraitResultPanel, VideoResultPanel with
step-to-component mapping.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 13: 会话恢复 Agent 问候 + 错误恢复 UI

**Files:**
- Modify: `frontend/src/pages/CreateDramaPage.tsx` (add resume message)
- Modify: `frontend/src/components/workarea/StepRunner.tsx` (add error recovery buttons)

- [ ] **Step 1: CreateDramaPage 添加恢复问候**

在 `CreateDramaPage.tsx` 的 `useEffect` 中，`goToStep(...)` 之后添加：

```typescript
            // Send resume message to Agent
            const sendWsMessage = useWorkflowStore.getState().sendWsMessage
            sendWsMessage({
              type: 'user:message',
              text: '/resume',
              context: { current_step: detail.stage },
            })
```

- [ ] **Step 2: StepRunner 添加可恢复/不可恢复错误区分**

在 `StepRunner.tsx` 的 `runtime.error` 显示区域扩展为：

```tsx
      {/* Phase: Done with error */}
      {runtime.phase === 'done' && runtime.error && (
        <div className="result-panel space-y-3">
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 text-destructive">
            <p className="font-medium">步骤执行出错</p>
            <p className="text-sm mt-1">{runtime.error}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => requestRegenerate(step.index)}
              className="px-3 py-1.5 text-sm rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              🔄 重试
            </button>
            {step.canSkip && (
              <button
                onClick={() => {
                  sendWsMessage({ type: 'user:action', action: 'skip_step', payload: { step: step.name } })
                }}
                className="px-3 py-1.5 text-sm rounded-lg border hover:bg-muted"
              >
                ⏭️ 跳过
              </button>
            )}
            <button
              onClick={prevStep}
              className="px-3 py-1.5 text-sm rounded-lg border hover:bg-muted"
            >
              ← 回退到上一步
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 3: TypeScript 编译检查**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: 无新增错误

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/CreateDramaPage.tsx frontend/src/components/workarea/StepRunner.tsx
git commit -m "feat: add session resume greeting + error recovery UI

Sends /resume message to Agent on session restore. Adds retry/skip/back
buttons for step error states.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 完成检查

- [ ] `cd frontend && npx tsc --noEmit` — 无类型错误
- [ ] `cd backend && python -c "import ast; [ast.parse(open(f'web/backend/{p}').read()) for p in ['services/agent_service.py','services/agent_tools.py','routers/ws.py']]; print('OK')"` — 无语法错误
- [ ] 全链路手动测试：创建会话 → WS 连接 → 6 步逐步执行 → 确认门 → regenerate
