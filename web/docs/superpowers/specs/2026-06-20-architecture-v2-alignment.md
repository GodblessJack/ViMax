# ViMax V2 架构对齐 — 修复设计文档

**日期:** 2026-06-20
**状态:** 设计完成，待用户审查
**参考:** `web/docs/architecture-v2-design.md`

## 背景

对 `architecture-v2-design.md` 的全面审计发现 22 个差距（8 个 P1, 14 个 P2），总体完成度约 65%。本设计按原始设计文档的 Phase 1→2→3 顺序，渐进式补齐缺口。

## Phase 1: WorkflowStore 补全

### 1.1 新增状态字段

```typescript
// WorkflowState interface 新增
sessionStage: SessionStage | null;
currentStepIndex: number;
confirmedSteps: Set<number>;
errors: PipelineError[];
```

`wsConnected` 不新增 — `connectionState === 'connected'` 已表达同一语义。

### 1.2 新增 Actions

```typescript
// 会话
setSession(id: string, stage: SessionStage): void;
clearSession(): void;

// 步骤导航
goToStep(index: number): void;
nextStep(): void;
prevStep(): void;
confirmStep(index: number): void;
requestRegenerate(index: number, feedback?: string): void;
requestModify(index: number, changes: Record<string, unknown>): void;

// 产物
patchArtifact(key: string, patch: Partial<unknown>): void;

// 错误
addError(error: PipelineError): void;
clearError(step: string): void;
clearAllErrors(): void;
```

### 1.3 handleWsEvent 新增处理

| 事件 | 处理 |
|------|------|
| `agent:workflow_started` | 设置 sessionStage, activeStepName |
| `agent:reply` | addChatMessage('ai', content, suggestions) |
| `agent:regenerate_ack` | 重置步骤 runtime 为 'preparing' |
| `agent:confirm_ack` | confirmStep + 清除 pendingConfirmation |
| `agent:navigate` | goToStep(target_index) |
| `event:ack` | no-op |
| `event:error` | addError |
| `pong` | no-op |

**改动文件:** `frontend/src/stores/types.ts`, `frontend/src/stores/workflowStore.ts`

---

## Phase 1: WS 类型对齐

### 新增 WsServerEvent 子类型（8 个）

`AgentWorkflowStartedEvent`, `AgentReplyEvent`, `AgentRegenerateAckEvent`, `AgentConfirmAckEvent`, `AgentNavigateEvent`, `EventAckEvent`, `EventErrorEvent`, `PongEvent`

全部加入 `WsServerEvent` union type，确保 TypeScript 穷举检查覆盖所有后端发送的事件类型。

**改动文件:** `frontend/src/stores/types.ts`（类型定义）, `frontend/src/stores/workflowStore.ts`（switch-case 处理）

---

## Phase 1: 组件结构调整

### 新建组件

```
components/workarea/
├── WorkArea.tsx              # 工作区容器
├── StepNavigationBar.tsx     # 顶部步骤条（可点击导航）
├── StepRunner.tsx            # 当前步骤三阶段卡片
│   ├── PreparingPanel.tsx    # 准备面板
│   ├── RunningPanel.tsx      # 生成中面板（流式文本）
│   └── ResultPanel.tsx       # 结果面板
└── StepActions.tsx           # [上一步][确认][重新生成][讨论]
```

### 数据流

- `WorkArea` 读取 `store.steps`, `store.currentStepIndex`, `store.stepRuntime`
- `StepNavigationBar` 调用 `store.goToStep(index)`
- `StepActions` 调用 `store.confirmStep()` / `store.requestRegenerate()` — 内部通过 `store.sendWsMessage()` 发送 WS 事件
- `ResultPanel` 根据 `currentStep.name` 选择专用渲染（Phase 3 补齐）

### CreateDramaPage 简化

移除所有 `useState`，改为直接从 WorkflowStore 读取。移除 `useEffect` 单向同步层。使用 `<WorkArea />` + `<AIChatPanel />` 替代内联的 5 个 step wizard 组件。

旧组件（`wizard/StepIndicator`, `StepRunner/StepRunnerCard`）保留但标记 `@deprecated`。

**改动文件:** `CreateDramaPage.tsx`（重写）, `workarea/*.tsx`（7 个新建）

---

## Phase 2: Agent 集成打通

### 2.1 对齐 run_step 枚举值

`agent_tools.py` 的 tool schema 中 `step` 参数枚举从 `develop_story | extract_characters | write_script | plan_scenes | character_portraits | render_scenes` 改为设计文档要求的 `story_generation | character_extraction | script_writing | storyboard_design | character_portraits | video_rendering`。

同步更新 `_STEP_SUGGESTIONS` 和 `_get_suggestions_for_step` 中的 key。

### 2.2 run_step 真实调用 Pipeline

移除 stub 实现。`tool_run_step()` 调用 `PipelineService` 对应方法执行实际的 pipeline 逻辑。通过 WS 实时推送 `step:preparing` / `step:running` / `step:stream_chunk` / `step:completed`。

若 PipelineService 内部方法不支持单步调用，先通过 `start_planning` / `start_rendering` 封装适配，后续可重构为细粒度方法。

### 2.3 6 步完整工作流

`_run_workflow_steps` 从硬编码 3 步改为遍历 `WORKFLOW_STEPS[0..5]`：

```python
for step_def in WORKFLOW_STEPS:
    if step_def.canSkip and should_skip(step_def, session_state):
        continue
    await self._execute_step(session_id, step_def)
    if step_def.requiresConfirmation:
        response = await self._confirmation_gate.wait_for_confirmation(...)
        # handle confirm/modify/regenerate
broadcast(session_id, {"type": "pipeline:complete", ...})
```

### 2.4 user:regenerate 真实逻辑

`ws.py` 收到 `user:regenerate` → `agent_service.handle_regenerate(session_id, step, feedback)` → 重置该步骤 runtime → 重新调用 `tool_run_step`。

**改动文件:** `backend/services/agent_tools.py`, `backend/services/agent_service.py`, `backend/routers/ws.py`

---

## Phase 3: 精化

### 3.1 6 个专用 ResultPanel

```
components/workarea/panels/
├── StoryResultPanel.tsx         # 富文本 + 章节树
├── CharacterResultPanel.tsx     # 角色卡片网格
├── ScriptResultPanel.tsx        # 场景/对白列表
├── StoryboardResultPanel.tsx    # 分镜网格 + 场景切换
├── PortraitResultPanel.tsx      # 肖像画廊
└── VideoResultPanel.tsx         # 播放器 + 下载
```

初期用通用 ResultPanel 展示 `summary`，专用 Panel 逐个替换。

### 3.2 会话恢复 Agent 问候

`CreateDramaPage` restore 后发送 `user:message { text: "/resume" }` → Agent 回复 "欢迎回来，你之前在 [步骤]。要继续吗？"

### 3.3 错误恢复 UI

`StepRunner` 区分可恢复错误（显示 `[重试] [修改参数] [跳过]`）和不可恢复错误（显示 Agent 解释 + `[回退到上一步]`）。

---

## 错误处理原则

- 每个步骤若可恢复：`step:error` 事件含 `recoverable: true`
- 不可恢复：`pipeline:error` 事件 → 整体流程暂停
- Store 维护 `errors[]` 数组供全局展示
- Agent 在收到 error 后主动给出建议（"要我重试吗？"）

## 测试策略

- Phase 1：手动验证 Store action + WS 事件流 + 组件渲染
- Phase 2：端到端测试 run_step → 确认门 → 6 步全流程
- Phase 3：每个 ResultPanel 快照测试 + 会话恢复测试

## 迁移兼容

- 旧组件标记 `@deprecated` 不删除，避免破坏现有 Step4/Step5 的遗留路径
- 新旧 WS hook 暂时共存，Phase 2 完成后移除 `usePipelineWebSocket`
- REST 端点不变，Phase 中不修改 API 契约

---

## 自我审查

- [x] 无占位符/TODO
- [x] 内部一致：Store → WS → 组件 → Agent 各层对齐
- [x] 范围可控：3 个 Phase，每个独立可测
- [x] 无歧义：所有 action/event/组件名称精确
