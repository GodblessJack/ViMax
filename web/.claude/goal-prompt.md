# ViMax Web — /goal 模式指南

## 是什么

`/goal` 让你设置**可验证的完成条件**，Claude 完成后自动停止。条件可以是一组可运行的验证命令，或一个检查清单。

## 为什么用

- 避免"差不多完成了"但没有真实验证
- 大任务自动分段（每完成一段自动 commit）
- 与 `loop.config.yaml` 刹车配合：达到条件即停，不浪费 tokens

## 好 Goal vs 坏 Goal

| ❌ 坏 Goal（主观） | ✅ 好 Goal（可验证） |
|-------------------|---------------------|
| "优化前端性能" | "所有页面 Lighthouse score > 90" |
| "修复 bug" | "pytest 全部通过 + tsc 无错误" |
| "改进代码质量" | "maker-checker.sh 三层验证全部 exit 0" |
| "完成 WebSocket 重构" | "test_ws_reconnect.py 通过 + 手动 WS 断连重连正常" |

## 核心原则

1. **编写独立验证脚本**：`/goal` 的最佳实践是先写好验证脚本，然后 `/goal` 引用它
2. **Maker ≠ Checker**：写代码的 Claude 和验证条件的 Claude 不是同一轮（使用 PreToolUse + PostToolUse hooks 强制分离）
3. **小步 Commit**：每完成一个 goal → git commit → 下一个 goal
4. **配刹车**：永远 `loop.config.yaml` + `/goal` 配套使用

## ViMax 项目典型 Goal 模板

### Goal: Fix a Bug

```
/goal 修复 B{n} bug
必须满足:
1. cd web/backend && python -m pytest tests/ -x -q (全部通过)
2. cd web/frontend && npx tsc --noEmit (零错误)
3. 手动验证: 复现原始 bug 的步骤 → 确认不再出现
4. STATUS.md 更新: bug 从 Next 移到 Done

刹车: max_turns=40, budget=$1
```

### Goal: 新增前端组件

```
/goal 实现 {ComponentName} 组件
必须满足:
1. npx tsc --noEmit (零 TypeScript 错误)
2. 组件在你的浏览器中渲染正确
3. 所有相关 Zustand store 订阅正常工作
4. WebSocket 事件处理器正确注册和清理

刹车: max_turns=30, budget=$0.50
```

### Goal: 后端 API 变更

```
/goal 实现 {端点名} 端点
必须满足:
1. pytest tests/ -x -q (全部通过，包含新端点测试)
2. curl 测试: 200/201/422 响应正确
3. WebSocket 事件推送与前端类型一致
4. architecture-v2-design.md 已更新对应部分

刹车: max_turns=50, budget=$1.50
```

### Goal: 全链路验证

```
/goal 端到端验证
必须满足:
1. pytest tests/ -x -q (后端全部通过)
2. npx tsc --noEmit (前端零错误)
3. cd web/backend && python main.py → 启动无报错
4. cd web/frontend && npm run dev → 启动无报错
5. 创建新 session → 走完 6 步 → 确认视频可用
6. STATUS.md heartbeat 已更新

刹车: max_turns=80, budget=$2
```

## 配合 Hook 系统

/goal 模式与项目 hooks 协同工作：

```
/goal 启动
  ↓
SessionStart → heartbeat-check.sh (检查健康状态)
  ↓
Claude 工作循环
  ├── PreToolUse → circuit-breaker.sh (每次写前检查)
  ├── PostToolUse → maker-checker.sh (每次写后验证)
  └── PreCompact → checkpoint.sh (压缩前保存状态)
  ↓
goal 条件满足 → 自动停止
  ↓
StopFailure → learning-capture.sh (如有错误)
```

## 技巧

- **小 Goal**：每个 goal 不超过 40 turns，$1 budget。大任务拆成小 goal 链
- **验证优先**：在描述 goal 时先写验证命令，再写修改范围
- **做减法**：如果 goal 条件太多（>5 条），说明 goal 太大，拆开
- **注意 DeepSeek**：温度设低（0.1-0.3），结构化输出更稳定
