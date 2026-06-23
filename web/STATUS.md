# ViMax Web 开发状态

> 最后更新: 2026-06-23T23:30 | 会话: pipeline version | 分支: feature-v3-upgrade | V3 全部完成 + B34 修复

## ✅ Done

- [x] WebSocket 双向通信架构（ws.py ↔ useSessionWebSocket.ts）
- [x] 6 步创建工作流（story → characters → script → storyboard → portraits → video）
- [x] ConfirmationGate 暂停/恢复机制
- [x] Agent Tools 8 个工具定义（get_session_state, read_artifact, run_step, update_artifact, request_confirmation, navigate_to_step, ask_user, skip_step）
- [x] Session CRUD（sessions.py 路由 + session_service.py）
- [x] Zustand WorkflowStore 共享状态层
- [x] 4 栏布局（nav + pipeline tree + workspace + AI chat）
- [x] 步骤运行时三阶段显示（preparing → running → done）
- [x] 分镜审阅多场景切换
- [x] AI 对话面板上下文感知 + 快捷操作
- [x] StepIndicator 点击导航
- [x] 启动恢复 orphaned sessions
- [x] Dynamic HTML Artifacts Agent 沙箱
- [x] B1-B33 共 33 个 bug 修复（详见 memory/bugfix-round-*.md）
- [x] UX Enhancement R1-R3（进度面板 WS 实时驱动、分镜审阅、AI 介入）
- [x] ✅ AI-Pipeline深度集成（6个Agent工具 + 公开API调用 + 用户意图解析）
- [x] ✅ 预确认门系统（step:need_confirm_before + pre_step_confirm）
- [x] ✅ 后确认门增强（子步骤可见 + WS驱动替换轮询）
- [x] ✅ WorkArea↔ChatPanel双向同步（ConfirmationGate共享 + SyncState）
- [x] ✅ 双边确认按钮一致（幂等确认 + confirmedBy追踪）
- [x] ✅ ChatPanel硬编码移除（Agent驱动意图解析）
- [x] ✅ WorkArea轮询移除（纯WS驱动）
- [x] **LoopEngineer 开发基础设施部署**（6 块构建块，12 个文件）
  - [x] CLAUDE.md 项目规则 + DeepSeek 适配
  - [x] STATUS.md 状态持久化
  - [x] LEARNINGS.md 错误记忆（10P + 7G + 5F）
  - [x] loop.config.yaml 刹车系统
  - [x] 5 个 hook 脚本（heartbeat-check, circuit-breaker, maker-checker, checkpoint, learning-capture）
  - [x] 2 个 skill（triage, learning）
  - [x] 1 个 agent（reviewer）

## 🏃 In Progress

### V3 架构升级 (feature-v3-upgrade, committed: 1422fbe)

- [x] **B1 (P0)**: REST start-workflow 绕过 V3 预确认门 — 2026-06-23
  - CreateDramaPage.tsx → WS `user:action` 替代 REST
  - agent_service.py → `start_workflow()` 替代 `psvc.start_planning()`
- [x] **B2 (P2)**: ChatPanel 预确认缺"修改后执行"按钮 — 2026-06-23
  - AIChatPanel.tsx: 预确认区新增"修改后执行"按钮 + 修改意见输入框
- [x] **字段名修正**: user:message `text` → `message` — 2026-06-23
  - types.ts + StepActions.tsx 统一为 `message`
- [x] **ConfirmationGateInline.tsx**: 预确认组件提取 — 2026-06-23
  - 从 AIChatPanel 提取为独立可复用组件
  - 含确认/修改后执行/取消按钮 + 修改输入区
- [x] **Gap #4 (P1)**: 拆分 _run_planning 批量执行为独立步骤 — 2026-06-23
  - agent_tools.py: tool_request_step_execution 改用 run_step() 替代 start_planning()
  - 每步独立执行，匹配 V3 逐步确认流程
- [x] **loop.config.yaml**: write_branches 加入 feature-v3-upgrade — 根因修复
- [x] **Round 5**: /triage → /reviewer — 2026-06-23
  - /triage: 故障分类完成，heartbeat 更新
  - /reviewer: Correctness/Security/Architecture/Edge Cases 4维度审查通过
    - 双路径竞态已修复 (agent_service.py stage guard)
    - 文档偏差已修正
    - 3 项预存问题记录 (非阻塞)
  - 后端程序化验证: session 创建 201 OK, 前端 Vite 200 OK
  - 验证: pytest ✅ (16p), tsc ✅ (0e)
- [x] **Round 4**: WS E2E 程序化验证通过 — 2026-06-23
  - 完整 V3 gated 流程验证: create → WS → user:action → agent:workflow_started
    → step:need_confirm_before → user:confirm_before → pipeline:status
  - 预确认门正确弹出并阻塞，确认后步骤开始执行
- [x] **Mock E2E 全 6 步验证**: VIMAX_MOCK=1 端到端通过 — 2026-06-23T23:31
  - 6/6 步骤完成: story_generation → character_extraction → script_writing
    → storyboard_design → character_portraits → video_rendering
  - 5/5 后确认门弹出 (video_rendering 为最后步骤自动完成)
  - storyboard_design 多场景循环已修复（不再死循环）
  - 63 events received, 0 errors
- [x] **B34 (P0)**: script2video_pipeline.py model_dump crash — 2026-06-23
  - 根因: pipeline_service.run_storyboard_scene 从 JSON 加载 characters 为 dicts
  - plan_text_artifacts → character.model_dump() → AttributeError on dict
  - 修复: plan_text_artifacts + __call__ 入口处标准化 characters (dict → CharacterInScene)
  - 修复: run_storyboard_scene 加载 characters 后立即转换 CharacterInScene
  - 修复: Agent 系统提示移除 create_story 推荐 → 引导使用 run_step (V3 gated)
  - E2E 测试端口修正: 9876 → 8000

## 📋 Next

### /triage 发现 (2026-06-23T23:30)

- [P1] **浏览器 E2E**: 完整 6 步流程验证 — 需用户操作 `localhost:5173/create`
- [P1] **snapshot 干扰**: Claude Code 快照重启 worktree 后端覆盖 port 8000，需手动 kill
- [P2] **Gap #8**: Artifact diff 追踪 — 已确认 difflib 实现，可进一步增强
- [P2] **Gap #9**: Pipeline 内省工具 — inspect_pipeline 已实现，可增强子步骤粒度
- [P3] **maker-checker hook**: 使用系统 python3 而非 .venv，偶发 pytest 误报

### 通用待办

- [P0] Agent 断线重连后 session 状态完整恢复
- [P1] 视频渲染进度实时推送优化（大视频场景）
- [P1] 分镜审阅 UX 完善（拖拽排序、批量确认）
- [P3] 移动端响应式适配
- [P3] 暗色模式支持

## 🚫 Never

- 不直接修改 `backend/.venv/`、`../.working_dir/`、`../.vimax/`
- 不手动编辑 `../.vimax/sessions.json`（通过 SessionService API）
- 不直接 push 到 main 分支
- 不修改 ViMax 核心引擎（`../agents/`、`../pipelines/`）的公开 API 签名
- 不绕过 ConfirmationGate 机制
- 不修改 `../agent_runtime/` 的 TUI 相关代码
- 不删除或压缩 memory/ 目录下的 bugfix 记录
- 不删除 LoopEngineer 基础设施（`loop.config.yaml`、`.claude/hooks/`、`LEARNINGS.md`、`STATUS.md`）
