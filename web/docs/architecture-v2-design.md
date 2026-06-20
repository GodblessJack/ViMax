# ViMax Web V2 — 双向平权架构设计

## 1. 核心原则

```
工作区 (确认区) ←── 双向平权 ──→ 对话区 (Agent)

- 工作区可推进步骤（按钮导航 + 确认）
- 对话区可驱动工作区（自然语言 → Agent → 修改 artifacts）
- 两者共享同一个 WorkflowStore，任一方的变化立即在另一方可见
- Agent 是决策大脑，Pipeline Tools 是执行手脚，工作区是可视化监视器
```

## 2. 共享状态层 — WorkflowStore

### 2.1 技术选型：Zustand

选择 Zustand 而非 Redux/Context：
- 无 Provider 包裹，组件树零改动
- 选择性订阅，性能好
- 支持 middleware（持久化、devtools、immer）
- `create()` 即可，不需要 Provider 嵌套

### 2.2 Store 结构

```typescript
// frontend/src/stores/workflowStore.ts

interface WorkflowState {
  // ===== 会话 =====
  sessionId: string | null;
  sessionStage: SessionStage; // 'created' | 'narrative_planning' | 'narrative_planned' | 'rendering' | 'rendered'

  // ===== 工作流步骤 =====
  steps: WorkflowStep[];          // 所有步骤的定义（顺序、名称、状态）
  currentStepIndex: number;       // 当前活跃步骤索引
  confirmedSteps: Set<number>;    // 已确认的步骤索引集合

  // ===== 产物 =====
  artifacts: {
    idea: string | null;
    style: string | null;
    story: string | null;
    characters: Character[] | null;
    script: SceneScript[] | null;
    storyboards: Record<number, StoryboardScene> | null;  // scene_index → scene
    characterPortraits: PortraitRegistry | null;
    finalVideoUrl: string | null;
  };

  // ===== 步骤运行时状态 =====
  stepRuntime: Record<string, StepRuntime>;  // stepName → 运行时状态

  // ===== 对话 =====
  chatMessages: ChatMessage[];
  agentSuggestions: AgentSuggestion[];  // Agent 主动给出的建议

  // ===== 确认队列 =====
  pendingConfirmation: PendingConfirmation | null;  // 当前等待用户确认的步骤

  // ===== WebSocket =====
  wsConnected: boolean;
  wsConnectionState: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

  // ===== 错误 =====
  errors: PipelineError[];
}

// ── 子类型 ──

interface WorkflowStep {
  index: number;
  name: string;           // 唯一标识: 'story_generation', 'character_extraction', ...
  label: string;          // 中文显示: '故事构思'
  status: StepStatus;     // 'idle' | 'preparing' | 'running' | 'completed' | 'error' | 'skipped'
  icon: string;           // Lucide icon name
  canSkip: boolean;       // 是否可跳过
  requiresConfirmation: boolean; // 是否需要用户确认
}

type StepStatus = 'idle' | 'preparing' | 'running' | 'completed' | 'error' | 'skipped';

interface StepRuntime {
  stepName: string;
  phase: 'preparing' | 'running' | 'done';  // 三阶段
  startTime: number | null;
  endTime: number | null;
  progressPercent: number;     // 0-100
  progressMessage: string;     // "正在生成故事...80%"
  streamedOutput: string;      // LLM 流式输出文本
  result: StepResult | null;   // 结构化结果
  error: string | null;
}

interface StepResult {
  summary: string;             // 人类可读的摘要
  artifactPaths: string[];     // 产生的文件路径
  previewData: unknown;        // 预览数据（取决于步骤类型）
  editableFields: EditableField[];  // 可编辑字段
}

interface EditableField {
  path: string;          // JSON path: "characters[0].name"
  label: string;         // 中文标签: "角色名"
  type: 'text' | 'textarea' | 'select' | 'number';
  value: unknown;
  options?: { label: string; value: string }[];  // for select
}

interface PendingConfirmation {
  stepIndex: number;
  stepName: string;
  message: string;           // Agent 的确认提示: "故事已经生成，要确认进入下一步吗？"
  suggestions: string[];     // 建议操作: ["确认", "修改主角名", "重新生成"]
  timestamp: number;
}

interface AgentSuggestion {
  id: string;
  type: 'question' | 'warning' | 'tip' | 'action';
  message: string;
  action?: {
    label: string;
    type: 'confirm' | 'modify' | 'regenerate' | 'navigate';
    payload: unknown;
  };
  dismissed: boolean;
}

interface PipelineError {
  step: string;
  message: string;
  timestamp: number;
  recoverable: boolean;
}
```

### 2.3 Store Actions

```typescript
interface WorkflowActions {
  // 会话
  setSession: (id: string, stage: SessionStage) => void;
  clearSession: () => void;

  // 步骤导航
  goToStep: (index: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  confirmStep: (index: number) => void;
  requestRegenerate: (index: number, feedback?: string) => void;
  requestModify: (index: number, changes: Record<string, unknown>) => void;

  // 产物
  updateArtifact: <K extends keyof WorkflowState['artifacts']>(
    key: K, value: WorkflowState['artifacts'][K]
  ) => void;
  patchArtifact: <K extends keyof WorkflowState['artifacts']>(
    key: K, patch: Partial<WorkflowState['artifacts'][K]>
  ) => void;

  // 步骤运行时
  updateStepRuntime: (stepName: string, update: Partial<StepRuntime>) => void;
  appendStreamedOutput: (stepName: string, chunk: string) => void;

  // 对话
  addChatMessage: (msg: ChatMessage) => void;
  addAgentSuggestion: (suggestion: AgentSuggestion) => void;
  dismissSuggestion: (id: string) => void;

  // 确认
  setPendingConfirmation: (conf: PendingConfirmation | null) => void;

  // WebSocket
  setWsState: (connected: boolean, state: string) => void;

  // 错误
  addError: (error: PipelineError) => void;
  clearError: (step: string) => void;
  clearAllErrors: () => void;

  // 发送 WS 消息（底层调用 WebSocket.send）
  sendWsMessage: (msg: WsClientMessage) => void;
}
```

## 3. WebSocket 双向协议

### 3.1 连接

```
ws://host/ws/session/{session_id}
```

单一 WebSocket 承载所有双向通信（不再区分 pipeline WS 和 chat HTTP）。

### 3.2 服务端 → 客户端事件

```typescript
// ===== 步骤生命周期 =====
interface StepPreparingEvent {
  type: 'step:preparing';
  step: string;           // step name
  context: {              // Agent 展示的准备上下文
    inputs: Record<string, unknown>;
    constraints: string[];
    agentIntent: string;  // Agent 对这一步的意图描述
  };
}

interface StepRunningEvent {
  type: 'step:running';
  step: string;
  progress_percent: number;
  progress_message: string;
}

interface StepStreamChunkEvent {
  type: 'step:stream_chunk';
  step: string;
  chunk: string;          // LLM 流式输出片段
}

interface StepCompletedEvent {
  type: 'step:completed';
  step: string;
  result: StepResult;
}

interface StepErrorEvent {
  type: 'step:error';
  step: string;
  error: string;
  recoverable: boolean;
}

// ===== 确认门 =====
interface StepNeedConfirmEvent {
  type: 'step:need_confirm';
  step: string;
  message: string;
  suggestions: string[];
}

// ===== 产物变更 =====
interface ArtifactUpdatedEvent {
  type: 'artifact:updated';
  artifact_key: string;   // 'story' | 'characters' | ...
  content: unknown;       // 完整内容
  diff?: {                // 可选：增量 diff
    path: string;
    old_value: unknown;
    new_value: unknown;
  };
}

// ===== Agent 消息 =====
interface AgentMessageEvent {
  type: 'agent:message';
  content: string;
  suggestions?: AgentSuggestion[];
}

interface AgentAskEvent {
  type: 'agent:ask';
  question: string;
  options?: { label: string; value: string }[];
}

// ===== Pipeline 整体状态 =====
interface PipelineStatusEvent {
  type: 'pipeline:status';
  stage: SessionStage;
  message: string;
}

interface PipelineCompleteEvent {
  type: 'pipeline:complete';
  stage: string;
  final_video_url?: string;
}

// ===== 连接 =====
interface ConnectedEvent {
  type: 'connected';
  session_id: string;
  current_step: string;
  session_stage: SessionStage;
}

// Union type
type WsServerEvent =
  | StepPreparingEvent | StepRunningEvent | StepStreamChunkEvent
  | StepCompletedEvent | StepErrorEvent | StepNeedConfirmEvent
  | ArtifactUpdatedEvent | AgentMessageEvent | AgentAskEvent
  | PipelineStatusEvent | PipelineCompleteEvent
  | ConnectedEvent;
```

### 3.3 客户端 → 服务端事件

```typescript
// ===== 步骤操作 =====
interface UserConfirmEvent {
  type: 'user:confirm';
  step: string;
}

interface UserModifyEvent {
  type: 'user:modify';
  step: string;
  changes: Record<string, unknown>;  // 具体的修改内容
  feedback?: string;                 // 用户的自然语言反馈
}

interface UserRegenerateEvent {
  type: 'user:regenerate';
  step: string;
  feedback?: string;
}

interface UserNavigateEvent {
  type: 'user:navigate';
  target_step: string;
}

// ===== 对话 =====
interface UserMessageEvent {
  type: 'user:message';
  text: string;
  context?: {
    current_step?: string;
    referenced_artifact?: string;
  };
}

// ===== 快捷操作 =====
interface UserActionEvent {
  type: 'user:action';
  action: string;          // 'regenerate_current' | 'skip_step' | 'restart_workflow'
  payload?: unknown;
}

// ===== 心跳 =====
interface PingEvent {
  type: 'ping';
}

type WsClientEvent =
  | UserConfirmEvent | UserModifyEvent | UserRegenerateEvent
  | UserNavigateEvent | UserMessageEvent | UserActionEvent
  | PingEvent;
```

## 4. Workflow Steps 定义

### 4.1 步骤列表

```typescript
const WORKFLOW_STEPS: WorkflowStep[] = [
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
    // 此步骤有子步骤（per scene）
    subSteps: ['scene_0', 'scene_1', 'scene_2', ...],
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
    requiresConfirmation: false,  // 渲染是最后一步，完成即完成
    // 也有子步骤（per scene）
    subSteps: ['scene_0', 'scene_1', 'scene_2', ...],
  },
];
```

### 4.2 每个步骤的三阶段展示

```
Step Panel UI Model:

┌──────────────────────────────────────────────┐
│  Step 1: 故事构思                    ● 进行中  │
├──────────────────────────────────────────────┤
│                                              │
│  📋 准备 (Preparing)                          │
│  ┌──────────────────────────────────────────┐│
│  │ 输入:                                     ││
│  │   Idea: "一个江湖恩怨的武侠故事"            ││
│  │   Style: "武侠"                           ││
│  │                                          ││
│  │ 约束:                                     ││
│  │   • 3-5个角色                             ││
│  │   • 时长约2分钟                            ││
│  │                                          ││
│  │ Agent 意图:                                ││
│  │   "我将根据你的武侠江湖设定，创作一个有      ││
│  │    起承转合、角色鲜明的短篇故事..."           ││
│  └──────────────────────────────────────────┘│
│                                              │
│  ⚡ 生成中 (Running)                           │
│  ┌──────────────────────────────────────────┐│
│  │ ████████████░░░░░░░░ 65%                  ││
│  │ 正在生成: 高潮段落...                       ││
│  │                                          ││
│  │ ┌─ 流式输出 ────────────────────────────┐ ││
│  │ │ 夜幕降临，张三站在悬崖边，回想起师傅    │ ││
│  │ │ 临终前的那句话："真正的剑道，不在剑，   │ ││
│  │ │ 而在心。"他缓缓拔出腰间的长剑...       │ ││
│  │ │ █                                    │ ││  ← 打字光标
│  │ └──────────────────────────────────────┘ ││
│  └──────────────────────────────────────────┘│
│                                              │
│  📦 结果 (Done)                               │
│  ┌──────────────────────────────────────────┐│
│  │ [完整故事文本 - 可滚动，可编辑]             ││
│  │                                          ││
│  │ 章节结构:                                  ││
│  │   1. 开端 - 师门灭门 (2段)                 ││
│  │   2. 发展 - 流落江湖 (3段)                 ││
│  │   3. 高潮 - 决战仇人 (2段)                 ││
│  │   4. 结局 - 归隐山林 (1段)                 ││
│  │                                          ││
│  │ [编辑] [展开全部]                          ││
│  └──────────────────────────────────────────┘│
│                                              │
│  ┌──────────────────────────────────────────┐│
│  │  [上一步]   [✅ 确认，进入角色设计]         ││
│  │            [🔄 重新生成]  [💬 在对话区讨论] ││
│  └──────────────────────────────────────────┘│
└──────────────────────────────────────────────┘
```

## 5. Agent Tools 定义

### 5.1 Agent 系统提示

```
你是 ViMax 的创作助手。你的职责是帮助用户完成短剧创作的全流程：
故事构思 → 角色设计 → 剧本写作 → 分镜设计 → 角色肖像 → 视频渲染。

原则：
1. 每个步骤完成后，必须等待用户确认才能进入下一步
2. 主动给用户建议，但不替用户做决定
3. 用户可以通过工作区按钮或对话区跟你交流
4. 如果用户提出修改，你要理解意图并用正确的 tool 执行
5. 保持对话简洁、友好、有洞察力
```

### 5.2 Tool 列表

```python
# backend/services/agent_tools.py

TOOLS = [
    # ── 读取 ──
    {
        "name": "get_session_state",
        "description": "获取当前会话的完整状态：当前步骤、已确认的步骤、所有产物",
        "parameters": {}
    },
    {
        "name": "read_artifact",
        "description": "读取一个产物的完整内容",
        "parameters": {
            "artifact_key": {
                "type": "string",
                "enum": ["idea", "style", "story", "characters", "script", "storyboard", "portraits"]
            },
            "scene_index": {
                "type": "integer",
                "description": "scene index, required when artifact_key is 'storyboard'"
            }
        }
    },

    # ── 执行步骤 ──
    {
        "name": "run_step",
        "description": "执行一个工作流步骤。Agent 调用此 tool 来启动步骤。执行过程中通过 WebSocket 实时推送进度。",
        "parameters": {
            "step": {
                "type": "string",
                "enum": [
                    "story_generation",
                    "character_extraction",
                    "script_writing",
                    "storyboard_design",
                    "character_portraits",
                    "video_rendering"
                ]
            },
            "params": {
                "type": "object",
                "description": "步骤特定参数，如 storyboard_design 的 scene_index"
            }
        }
    },

    # ── 修改产物 ──
    {
        "name": "update_artifact",
        "description": "修改一个产物。可以修改整个内容，或通过 JSON path 修改特定字段。修改后自动广播 artifact:updated 事件给前端。",
        "parameters": {
            "artifact_key": {
                "type": "string",
                "enum": ["story", "characters", "script", "storyboard"]
            },
            "changes": {
                "type": "object",
                "description": "变更内容。可以是完整替换，也可以是带 json_path 的局部修改"
            },
            "scene_index": {
                "type": "integer",
                "description": "scene index, required when artifact_key is 'storyboard'"
            }
        }
    },

    # ── 导航/控制 ──
    {
        "name": "request_confirmation",
        "description": "请求用户确认当前步骤。这会暂停 Agent 执行，等待用户反馈。",
        "parameters": {
            "step": {"type": "string"},
            "message": {"type": "string", "description": "给用户的确认消息"},
            "suggestions": {
                "type": "array",
                "items": {"type": "string"},
                "description": "建议操作，如 ['确认', '修改角色名', '重新生成']"
            }
        }
    },

    {
        "name": "navigate_to_step",
        "description": "跳转到指定步骤。只能跳转到已完成或当前步骤的上一步。",
        "parameters": {
            "target_step": {"type": "string"}
        }
    },

    # ── 问答 ──
    {
        "name": "ask_user",
        "description": "主动向用户提问。用于需要用户决策的场景。",
        "parameters": {
            "question": {"type": "string"},
            "options": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "value": {"type": "string"}
                    }
                }
            }
        }
    },

    # ── 快捷操作 ──
    {
        "name": "skip_step",
        "description": "跳过当前步骤（仅可跳过的步骤）。",
        "parameters": {
            "step": {"type": "string"},
            "reason": {"type": "string"}
        }
    },

    {
        "name": "restart_workflow",
        "description": "重新开始整个工作流。保留已有产物除非用户要求清空。",
        "parameters": {
            "clear_artifacts": {"type": "boolean", "default": false}
        }
    },
]
```

## 6. 后端架构

### 6.1 Agent Service

```python
# backend/services/agent_service.py

class AgentService:
    """
    Claude Agent SDK 驱动的工作流引擎。

    职责:
    - 管理 Agent 生命周期
    - 注册 Pipeline Tools
    - 处理用户消息（来自对话区或工作区按钮）
    - 通过 WebSocket 推送进度
    - 实施确认门机制
    """

    def __init__(self, session_id: str, pipeline_service: PipelineService):
        self.session_id = session_id
        self.pipeline = pipeline_service
        self.ws_manager = pipeline_service._ws_connections  # 复用

        # Agent 状态
        self.agent = None           # Claude SDK agent 实例
        self.current_step: str | None = None
        self.confirmation_gate: asyncio.Event | None = None
        self.pending_user_message: str | None = None

    async def start(self, initial_input: dict) -> None:
        """
        启动 Agent 主循环。
        initial_input 包含: idea, style, user_requirement
        """
        ...

    async def handle_user_message(self, message: str) -> None:
        """
        处理来自对话区的用户消息。
        如果 Agent 正在等待确认，这个消息可能是确认/修改指令。
        """
        ...

    async def handle_user_action(self, action: str, payload: dict) -> None:
        """
        处理来自工作区的用户操作（按钮点击）。
        action: 'confirm' | 'modify' | 'regenerate' | 'navigate'
        """
        ...

    async def _run_agent_loop(self) -> None:
        """
        Agent 主循环：
        1. 判断当前状态
        2. 决定下一步做什么
        3. 调用 tool
        4. 展示结果
        5. 请求确认
        6. 等待用户反馈
        7. 重复
        """
        ...

    async def _execute_step(self, step_name: str, params: dict) -> StepResult:
        """
        执行一个步骤：
        1. 发送 step:preparing
        2. 调用 Pipeline Tool
        3. 流式推送 step:stream_chunk
        4. 发送 step:completed
        5. 发送 step:need_confirm
        6. 设置确认门
        """
        ...

    def _broadcast(self, event: dict) -> None:
        """通过 WebSocket 广播事件给前端"""
        ...
```

### 6.2 确认门机制

```python
class ConfirmationGate:
    """
    确认门：Agent 执行完一个步骤后，
    - 设置此门 → Agent 暂停，等待用户
    - 用户确认 → 门打开 → Agent 继续
    - 用户修改 → 门打开 + 附带修改指令 → Agent 重新执行
    - 用户对话 → 消息传递给 Agent，Agent 在门内处理
    """

    def __init__(self):
        self._event = asyncio.Event()
        self._response: dict | None = None  # 用户的响应

    async def wait(self) -> dict:
        """Agent 在此等待，直到用户响应"""
        await self._event.wait()
        self._event.clear()
        return self._response

    def signal(self, response: dict) -> None:
        """用户响应（确认/修改/对话）"""
        self._response = response
        self._event.set()

    def is_waiting(self) -> bool:
        return not self._event.is_set()
```

### 6.3 路由改造

```python
# backend/routers/ws.py — 新的统一 WebSocket 端点

@router.websocket("/ws/session/{session_id}")
async def session_websocket(websocket: WebSocket, session_id: str):
    """
    统一的 Session WebSocket。
    承载所有双向通信：步骤事件、Agent 消息、用户操作。
    """
    await agent_service.register_ws(session_id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            event_type = data.get("type")

            if event_type == "user:message":
                await agent_service.handle_user_message(session_id, data["text"])
            elif event_type == "user:confirm":
                await agent_service.handle_user_action(session_id, "confirm", data)
            elif event_type == "user:modify":
                await agent_service.handle_user_action(session_id, "modify", data)
            elif event_type == "user:regenerate":
                await agent_service.handle_user_action(session_id, "regenerate", data)
            elif event_type == "user:navigate":
                await agent_service.handle_user_action(session_id, "navigate", data)
            elif event_type == "user:action":
                await agent_service.handle_user_action(session_id, data["action"], data.get("payload", {}))
            elif event_type == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        agent_service.unregister_ws(session_id, websocket)
```

### 6.4 保留的 REST 端点

```python
# 保留但简化：
GET    /api/sessions              # 列出会话
GET    /api/sessions/{id}         # 获取会话详情
POST   /api/sessions              # 创建会话
DELETE /api/sessions/{id}         # 删除会话

GET    /api/files/{session_id}/{file_path}  # 文件下载

GET    /api/works                 # 已完成的作品
GET    /api/works/{id}/download   # 下载

# 废弃：
# POST /api/pipeline/plan   → 由 Agent 的 run_step tool 替代
# POST /api/pipeline/render → 由 Agent 的 run_step tool 替代
# POST /api/chat            → 由 WebSocket user:message 替代
```

## 7. 前端组件重构

### 7.1 组件树

```
CreateDramaPage (精简为布局容器)
├── WorkArea (新组件 — 主确认区)
│   ├── StepNavigationBar     // 顶部步骤条，可点击导航
│   ├── StepRunner            // 当前步骤的三阶段卡片
│   │   ├── PreparingPanel    // 📋 准备面板
│   │   ├── RunningPanel      // ⚡ 生成中面板（流式文本）
│   │   └── ResultPanel       // 📦 结果面板（可编辑）
│   └── StepActions           // [上一步] [确认] [重新生成] [讨论]
│
└── AgentChatPanel (新组件 — 对话区)
    ├── MessageList           // Agent + 用户消息流
    │   ├── AgentMessage      // Agent 消息气泡
    │   └── UserMessage       // 用户消息气泡
    ├── SuggestionBar         // Agent 的当前建议
    ├── QuickActions          // 快捷操作按钮
    └── ChatInput             // 文本输入
```

### 7.2 组件关系和数据流

```
CreateDramaPage
  │
  ├─ useWorkflowStore() ───── 读取 sessionId, currentStepIndex
  │
  ├─ useEffect: 如果是新会话
  │     → POST /api/sessions { idea, style }
  │     → ws = new WebSocket(`ws://host/ws/session/${sessionId}`)
  │     → ws.onmessage → store.dispatch(parseWsEvent)
  │     → Agent 自动开始第一步
  │
  ├─ useEffect: 恢复会话（?session=xxx）
  │     → GET /api/sessions/{id}
  │     → store.setSession(id, stage)
  │     → store 批量 restore artifacts
  │     → ws 连接 → Agent 感知当前状态
  │
  ├─ <WorkArea>
  │    读取: store.steps, store.currentStepIndex, store.stepRuntime
  │    写入: store.goToStep(), store.confirmStep(), store.requestRegenerate()
  │    发送 WS: { type: "user:confirm", step }
  │            { type: "user:modify", step, changes }
  │            { type: "user:navigate", target_step }
  │
  └─ <AgentChatPanel>
      读取: store.chatMessages, store.agentSuggestions, store.pendingConfirmation
      写入: store.addChatMessage()
      发送 WS: { type: "user:message", text }
              { type: "user:action", action }
```

### 7.3 StepRunner 核心组件设计

```tsx
// frontend/src/components/workarea/StepRunner.tsx

function StepRunner() {
  const currentStep = useWorkflowStore(s => s.steps[s.currentStepIndex]);
  const runtime = useWorkflowStore(s => s.stepRuntime[currentStep.name]);
  const pendingConfirm = useWorkflowStore(s => s.pendingConfirmation);

  if (!currentStep) return null;

  return (
    <div className="step-runner">
      {/* 三阶段卡片 */}
      <PreparingPanel
        visible={runtime?.phase === 'preparing'}
        context={runtime?.preparingContext}
      />
      <RunningPanel
        visible={runtime?.phase === 'running'}
        progress={runtime?.progressPercent}
        message={runtime?.progressMessage}
        streamedOutput={runtime?.streamedOutput}
      />
      <ResultPanel
        visible={runtime?.phase === 'done'}
        result={runtime?.result}
        artifactData={/* 从 store.artifacts 取对应数据 */}
        onEdit={(path, value) => store.patchArtifact(...)}
      />

      {/* 操作按钮 */}
      {runtime?.phase === 'done' && (
        <StepActions
          step={currentStep}
          pendingConfirm={pendingConfirm}
          onPrev={store.prevStep}
          onConfirm={() => {
            store.confirmStep(currentStep.index);
            sendWs({ type: 'user:confirm', step: currentStep.name });
          }}
          onRegenerate={() => {
            store.requestRegenerate(currentStep.index);
            sendWs({ type: 'user:regenerate', step: currentStep.name });
          }}
          onDiscuss={() => {
            // 聚焦对话区，预填一个讨论 prompt
            store.setChatFocus(`我想讨论一下 ${currentStep.label}...`);
          }}
        />
      )}
    </div>
  );
}
```

### 7.4 AgentChatPanel 核心组件设计

```tsx
// frontend/src/components/layout/AgentChatPanel.tsx

function AgentChatPanel() {
  const messages = useWorkflowStore(s => s.chatMessages);
  const suggestions = useWorkflowStore(s => s.agentSuggestions);
  const pendingConfirm = useWorkflowStore(s => s.pendingConfirmation);
  const currentStep = useWorkflowStore(s => s.steps[s.currentStepIndex]);
  const sendWs = useWorkflowStore(s => s.sendWsMessage);

  const handleSend = (text: string) => {
    store.addChatMessage({ role: 'user', content: text });
    sendWs({
      type: 'user:message',
      text,
      context: { current_step: currentStep?.name }
    });
  };

  const handleQuickAction = (action: string, payload?: unknown) => {
    sendWs({ type: 'user:action', action, payload });
  };

  return (
    <div className="agent-chat-panel flex flex-col h-full">
      {/* Header */}
      <ChatHeader sessionId={store.sessionId} currentStep={currentStep} />

      {/* Messages */}
      <MessageList messages={messages} />

      {/* Agent Suggestions (主动建议) */}
      {suggestions.length > 0 && (
        <SuggestionBar
          suggestions={suggestions}
          onDismiss={store.dismissSuggestion}
          onAction={handleQuickAction}
        />
      )}

      {/* Pending Confirmation (等待确认提示) */}
      {pendingConfirm && (
        <ConfirmationBanner
          confirmation={pendingConfirm}
          onConfirm={() => handleQuickAction('confirm', { step: pendingConfirm.stepName })}
          onSuggest={(s) => handleSend(s)}
        />
      )}

      {/* Quick Actions */}
      <QuickActions
        currentStep={currentStep}
        onConfirm={() => handleQuickAction('confirm')}
        onRegenerate={() => handleQuickAction('regenerate')}
      />

      {/* Input */}
      <ChatInput onSend={handleSend} />
    </div>
  );
}
```

## 8. Step Result Panel — 按步骤类型的展示组件

每个步骤的结果有不同的最佳展示方式：

```typescript
// 步骤 → 结果组件映射
const STEP_RESULT_COMPONENTS: Record<string, React.ComponentType<{data: any}>> = {
  story_generation: StoryResultPanel,      // 富文本故事 + 章节树
  character_extraction: CharacterResultPanel, // 角色卡片网格
  script_writing: ScriptResultPanel,       // 场景/对白树形列表
  storyboard_design: StoryboardResultPanel, // 分镜镜头网格 + 场景切换
  character_portraits: PortraitResultPanel,  // 肖像画廊
  video_rendering: VideoResultPanel,       // 播放器 + 下载
};
```

每个 ResultPanel 都支持：
- **查看**：以最合适的方式展示数据
- **编辑**：内联编辑（文本字段）或弹出编辑（复杂对象）
- **预览**：图片/视频预览
- **选中**：支持多选操作（如批量修改镜头）

## 9. 会话恢复

```
用户打开 ?session=xxx
  → GET /api/sessions/{id}
  → store.setSession(id, stage)
  → 根据 artifacts 清单恢复 store.artifacts
  → 根据 stage 恢复已完成的 step status
  → ws 连接
  → Agent: "欢迎回来！你之前在 [当前步骤]。要继续吗？"
  → 用户可以：
    - 说 "继续" → Agent 从当前步骤继续
    - 点步骤条某一步 → Agent 跳转到那一步
    - 说 "重新生成角色" → Agent 回到角色步骤
```

## 10. 错误处理

```
步骤执行错误:
  → step:error 事件 → 工作区显示错误面板
  → Agent: "故事生成遇到问题，要我重试吗？"
  → 工作区: [🔄 重试] [✏️ 修改参数后重试] [⏭️ 跳过]

不可恢复错误:
  → pipeline:error → 整体失败
  → Agent 解释错误原因
  → 用户可选择回退到上一步
```

## 11. 迁移路径

### Phase 1: 基础设施（不破坏现有功能）

| 任务 | 描述 |
|------|------|
| 1.1 | 创建 Zustand WorkflowStore，与现有 useState 并行运行 |
| 1.2 | 改造 CreateDramaPage，逐步从 useState 迁移到 Store |
| 1.3 | 统一 WebSocket 为 `/ws/session/{id}`，兼容旧事件格式 |
| 1.4 | 实现 StepRunner 三阶段卡片组件（先用现有数据驱动） |

**Phase 1 结束状态**：UI 已经有三阶段展示，但后端还是批量执行

### Phase 2: Agent 集成

| 任务 | 描述 |
|------|------|
| 2.1 | 实现 AgentService，注册 Pipeline Tools |
| 2.2 | 实现确认门机制 |
| 2.3 | 将 `/api/chat` 替换为 WS 上的 `user:message` |
| 2.4 | Chat 接入 Agent SDK 的 tool calling |

**Phase 2 结束状态**：Agent 能逐步执行 pipeline，每步等待确认

### Phase 3: 精化

| 任务 | 描述 |
|------|------|
| 3.1 | 各步骤的 ResultPanel 组件完善 |
| 3.2 | Agent 主动建议优化 |
| 3.3 | 会话恢复完善 |
| 3.4 | 性能、错误处理、edge cases |

---

## 附录：关键文件清单

| 文件 | 变更类型 |
|------|----------|
| `frontend/src/stores/workflowStore.ts` | **新建** — Zustand store |
| `frontend/src/stores/types.ts` | **新建** — 类型定义 |
| `frontend/src/components/workarea/WorkArea.tsx` | **新建** — 工作区容器 |
| `frontend/src/components/workarea/StepRunner.tsx` | **新建** — 步骤运行器 |
| `frontend/src/components/workarea/StepNavigationBar.tsx` | **新建** — 步骤导航条 |
| `frontend/src/components/workarea/panels/*.tsx` | **新建** — 各步骤结果面板 |
| `frontend/src/components/layout/AgentChatPanel.tsx` | **重写** — 接入 Store + WS |
| `frontend/src/pages/CreateDramaPage.tsx` | **重构** — 精简为布局容器 |
| `frontend/src/hooks/useSessionWebSocket.ts` | **新建** — 统一 WS hook |
| `backend/services/agent_service.py` | **新建** — Agent 服务 |
| `backend/services/agent_tools.py` | **新建** — Agent Tools |
| `backend/routers/ws.py` | **重写** — 统一 WS 端点 |
| `backend/main.py` | **修改** — 注册新路由 |
