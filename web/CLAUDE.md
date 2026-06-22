# ViMax Web — Claude Code 项目规则

## 项目定位
ViMax Web 是 Agentic Video Generation 的 Web 管理界面，基于**双向平权架构**：
- 工作区（确认区）和对话区（Agent）共享同一个 Zustand WorkflowStore
- Agent 是决策大脑，Pipeline Tools 是执行手脚，工作区是可视化监视器

## 技术栈

| 层 | 技术 | 关键文件 |
|----|------|----------|
| 后端 | Python 3.12, FastAPI, uv 包管理 | `backend/main.py`, `backend/config.py` |
| 前端 | React 19, Vite 8, TypeScript 6, Zustand 5, TailwindCSS v4 | `frontend/src/main.tsx`, `frontend/src/stores/workflowStore.ts` |
| 通信 | WebSocket 双向协议 | `backend/routers/ws.py` ↔ `frontend/src/hooks/useSessionWebSocket.ts` |
| Agent | Claude Agent SDK + DeepSeek v4-pro | `backend/services/agent_service.py`, `backend/services/agent_tools.py` |
| LLM | DeepSeek v4-pro[1m]（通过 Anthropic 兼容 API） | 配置在 `~/.claude/settings.json` env |

## DeepSeek 环境特定规则

⚠️ 当前 Claude Code 通过 `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic` 使用 DeepSeek 后端。

1. **模型名**：始终使用 `deepseek-v4-pro[1m]`，不存在 haiku/opus/sonnet 等 Anthropic 模型
2. **Context 长度**：DeepSeek 支持 1M token context，但实际有效关注窗口约 128K-256K tokens。超长上下文可能丢失中间信息
3. **Temperature**：DeepSeek 的 temperature 行为与 Claude 不同，较低值（0.1-0.3）更适合结构化输出
4. **Tool Use**：DeepSeek 的 tool calling 格式兼容 Anthropic，但偶尔会返回非标准 JSON。注意 try/catch
5. **费用**：DeepSeek 比 Claude 便宜 10-50 倍，$1 可完成大量工作。但 loop.config.yaml 设 $3 刹车防 runaway
6. **Rate Limit**：DeepSeek 有速率限制，大量并行 agent 调用可能触发 429。建议并行不超过 6 个 subagent
7. **Subagent 模型**：所有 subagent 默认继承父会话的模型（deepseek-v4-pro[1m]），无需在 agent config 中指定模型

## 铁律

### 架构一致性
1. **WebSocket 事件类型修改**：修改 `frontend/src/stores/types.ts` 的 WS 事件类型时，必须同步检查 `backend/routers/ws.py` 的发送端和 `frontend/src/hooks/useSessionWebSocket.ts` 的消息处理器
2. **WorkflowStore 修改**：修改 `frontend/src/stores/workflowStore.ts` 后，必须验证所有订阅方仍正常工作（WorkArea、ChatPanel、StepNavigationBar）
3. **Agent Tools 修改**：修改 `backend/services/agent_tools.py` 的工具定义时，必须同步更新 `docs/architecture-v2-design.md` 的工具文档
4. **Pipeline 步骤定义**：`backend/services/pipeline_service.py` 的步骤名称必须与 `frontend/src/stores/types.ts` 的 `WorkflowStepName` 保持一致
5. **ConfirmationGate**：任何需要用户确认的操作必须经过 `backend/services/confirmation_gate.py`，不可绕过

### 代码质量
6. **后端修改后必须运行**：`cd web/backend && python -m pytest tests/ -x -q`
7. **前端修改后必须运行**：`cd web/frontend && npx tsc --noEmit`
8. **修改 config.py 后**：确认 `VIMAX_WEB_*` 环境变量前缀的 pydantic-settings 仍然生效

### 安全与操作
9. **永远不要直接修改** `backend/.venv/`、`../.working_dir/`、`../.vimax/` 中的文件
10. **永远不要手动编辑** `../.vimax/sessions.json`（通过 SessionService API 操作）
11. **永远不要 push 到 main 分支**。本地 main 只允许文档/配置类修改。代码变更始终通过 feature/fix 分支提交和合入。
12. **永远不要自动创建 worktree**。每个 worktree 是独立环境，创建或进入任何 worktree 前必须征得用户明确同意。
13. **Hook 脚本必须 fail-open**：任何 hook 脚本的错误都返回 exit 0，绝不能阻塞主流程
14. **JSON/配置文件修改后必须验证格式**：`python3 -m json.tool < file.json > /dev/null`
15. **LoopEngineer 基础设施文件**（`loop.config.yaml`、`.claude/hooks/`、`LEARNINGS.md`、`STATUS.md`）属于开发基础设施，不可删除

## 关键数据流

```
用户操作 → WorkArea/StepRunner
    ↕ (Zustand Store)
WebSocket → AgentService (Claude SDK via DeepSeek)
    ↕ (tool calls)
PipelineService → 核心引擎 (agents/, pipelines/)
    ↕ (artifacts)
SessionService → .working_dir/sessions/{id}/
```

## 6 步创建工作流

1. `story_generation` — 故事构思
2. `character_extraction` — 角色提取
3. `script_writing` — 剧本编写
4. `storyboard_design` — 分镜设计（多场景子步骤）
5. `character_portraits` — 角色肖像
6. `video_rendering` — 视频渲染（多场景子步骤，最耗时）

## 测试策略

- **后端 API 测试**：`cd web/backend && python -m pytest tests/test_api.py -x -q`
- **核心 workflow 测试**（在项目根目录运行）：`python test_workflow.py`
- **修改 pipeline_service.py 后**：必须运行核心 workflow 测试验证
- **修改 WebSocket 相关代码后**：必须手动验证 WS 连接、断线重连、事件收发

## 相关文档

- **使用指南**：`LOOPENGINEER.md`（如何用 /goal、/triage、/learning、reviewer、hooks 等全部机制）
- 错误记忆：`LEARNINGS.md`（10 Patterns + 11 Gotchas + 5 Fixes）
- 开发状态：`STATUS.md`（Done / In Progress / Next / Never）
- 刹车配置：`loop.config.yaml`（6 项安全机制）
- 架构设计：`docs/architecture-v2-design.md`

> 当用户问"怎么用 LoopEngineer"、"有哪些 hook"、"怎么启动任务"时，先 Read `web/LOOPENGINEER.md`。
