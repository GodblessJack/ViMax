# ViMax Web 开发状态

> 最后更新: 2026-06-22 | 会话: web-interface-v2 | 步骤: ~50 | 花费: 跟踪中

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

_当前无活跃任务_

## 📋 Next

- [P0] Agent 断线重连后 session 状态完整恢复
- [P1] 视频渲染进度实时推送优化（大视频场景）
- [P1] 分镜审阅 UX 完善（拖拽排序、批量确认）
- [P1] 后端 pipeline 错误信息结构化（区分用户错误 vs 系统错误）
- [P2] 大 session 加载性能优化（虚拟滚动、懒加载）
- [P2] AI 对话面板快捷操作扩展（更多上下文场景）
- [P2] 前端 E2E 测试框架引入（Playwright/Cypress）
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
