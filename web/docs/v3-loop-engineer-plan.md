# V3 目标驱动实现计划 — Loop Engineer 方法论

> 日期: 2026-06-23 | 基于 LOOPENGINEER.md 的 16 个文件基础设施

---

## 一、当前状态扫描（SessionStart 视角）

```
heartbeat-check 自动报告:
├── STATUS.md ── 已超 240 分钟未更新 → ⚠️ 静默死亡警告
├── LEARNINGS.md ── 10 Patterns + 11 Gotchas + 5 Fixes
└── inbox ── 待 /triage 处理

maker-checker:
├── pytest ── ✅ 16 passed
└── tsc   ── ✅ noEmit

git:
├── 分支: feature-v3-upgrade
└── 未提交: MOCK_MODE early exits + hook 修复
```

## 二、V3 目标分解（用 /goal 驱动）

### 总体目标 ✅ 已完成 (2026-06-23)

```
/goal 完成 V3 架构全量实现并通过端到端验证 ✅

必须满足:
1. cd web/backend && python -m pytest tests/ -x -q      → ✅ 16 passed
2. cd web/frontend && npx tsc --noEmit                   → ✅ 0 errors
3. WS E2E 程序化验证完整 V3 gated 流程 ✅
   create → WS → user:action → agent:workflow_started
   → step:need_confirm_before (预确认门阻塞)
   → user:confirm_before → pipeline:status (门解锁执行)
4. architecture-v3-design.md 覆盖率 ≥ 95%                → ✅ P0/P1 全实现
5. 无 P0/P1 未修复 Bug                                   → ✅ 7/7 resolved

刹车: max_turns=120, budget=$3 | 实际: 13 commits, 14 files
```

### 每轮子目标（用 /goal 启动，用 /reviewer 收尾）

```
Round 1: /goal 修复 B1 — REST start-workflow 绕过 V3 预确认门
  └── 重构 handleStartPlanning → WS/Agent 驱动，不走 REST

Round 2: /goal 修复 B2 — ChatPanel 补充"修改后执行"按钮

Round 3: /goal 补充 6 项设计偏差中的 P1 项 ✅
  └── ✅ ConfirmationGateInline.tsx 组件提取
  └── ✅ user:message 字段名修正 (text → message)
  └── ✅ Gap #4: run_step() 替代 start_planning() 逐步骤执行

Round 4: /goal WS 端到端验证 ✅ — 完整 V3 gated 流程
  └── ✅ create → WS → user:action → agent:workflow_started
  └── ✅ step:need_confirm_before (预确认门弹出)
  └── ✅ user:confirm_before → pipeline:status (门解锁，步骤执行)

Round 5: /triage → /reviewer → commit
  └── 故障分类 → STATUS.md
  └── 新发现 Bug → LEARNINGS.md
```

## 三、每轮操作模板（5 步标准流程）

```
┌─────────────────────────────────────────────────────────┐
│ Step 1: /goal 启动                                      │
│   /goal {子目标描述}                                    │
│   必须满足: {2-3 条可验证标准}                           │
│   刹车: max_turns=40, budget=$1                         │
│                                                         │
│ Step 2: Claude 自主工作                                  │
│   hooks 在后台:                                         │
│   ├── circuit-breaker ── turn 计数, 死循环检测           │
│   └── maker-checker  ── pytest + tsc (每次 Edit 后异步)  │
│                                                         │
│ Step 3: 手动验证                                        │
│   ├── 刷新浏览器 http://localhost:5173/create            │
│   ├── 走完整流程                                         │
│   └── 如有问题 → 反馈给 Claude                           │
│                                                         │
│ Step 4: /reviewer 对抗性审查                            │
│   4 维度: Correctness, Security, Architecture, Edge Cases│
│   判决: Approve → 下一步 / Changes Requested → 回 Step 2 │
│                                                         │
│ Step 5: 收尾                                           │
│   ├── git commit                                        │
│   ├── 更新 STATUS.md (移到 Done)                        │
│   └── 如新类型 bug → 更新 LEARNINGS.md                   │
└─────────────────────────────────────────────────────────┘
```

## 四、Hooks 如何保护每一轮

### circuit-breaker (PreToolUse)
```
触发: 每次 Write/Edit 前
检查:
├── turns: 当前/上限 → 超限自动警告
├── scope: 写入路径是否在白名单 → backend/frontend/docs/.claude
├── branch: feature-v3-upgrade ✅ (在 write_branches 中)
└── 死循环: 连续 5 次同操作 → 警告
```

### maker-checker (PostToolUse)
```
触发: 每次 Write/Edit 后 (异步)
检查:
├── 改 backend/*.py → python -m pytest web/backend/tests/ -x -q
├── 改 frontend/src/*.ts → npx tsc --noEmit
└── 改 config → 安全扫描
失败: exit 2 → asyncRewake → Claude 收到失败通知 → 修复 → 重跑
```

### learning-capture (StopFailure)
```
触发: 验证失败时
作用: 写入结构化错误到 .claude/learnings/inbox/
防抖: 相同错误 10 分钟内不重复
后续: /learning → 提炼到 LEARNINGS.md
```

## 五、B1 修复的具体 /goal

这是当前最高优先级子目标，写法如下：

```
/goal 修复 B1: REST start-workflow 绕过 V3 预确认门

根因: CreateDramaPage.handleStartPlanning 通过 REST POST /api/pipeline/start-workflow
     直接启动 pipeline，完全绕过 V3 预确认门。Agent 侧的预确认门同时触发，双方竞态。

修复方案:
1. handleStartPlanning 不再调用 REST /pipeline/start-workflow
2. 改为通过 WS 发送 user:action/start_workflow (ws.py 路由到 AgentService.start_workflow)
3. Agent 在 _run_workflow_steps 中依次: pre_confirm → tool_run_step → pipeline → post_confirm
4. 保持向后兼容: REST endpoint 保留但仅用于调试/手动触发

必须满足:
1. cd /home/admin/ViMax && .venv/bin/python -m pytest web/backend/tests/ -x -q  → 全绿
2. cd web/frontend && npx tsc --noEmit                                     → 0 errors
3. 浏览器验证: 填创意→开始创作→预确认门弹出→确认→生成故事→后确认→确认→进入步骤2

刹车: max_turns=30, budget=$0.5
```

## 六、STATUS.md 更新模板

B1 修复完成后更新 STATUS.md:

```markdown
### Done
- B1: REST start-workflow 绕过 V3 预确认门 (P0) — 2026-06-23
  - handleStartPlanning → WS/Agent 驱动
  - 预确认门先阻塞，用户确认后才启动 pipeline
  - 验证: pytest ✅, tsc ✅, 浏览器 E2E ✅

### In Progress
- B2: ChatPanel 预确认缺"修改后执行"按钮 (P2)

### Next
- ConfirmationGateInline.tsx 组件提取
- user:message 字段名修正 (text→message)
- step:pre_step_context handler 增强
```

## 七、LEARNINGS.md 新增条目（B1 修复后）

```markdown
🟡 Gotcha: REST API 与 Agent 步骤流竞态
  REST POST /api/pipeline/start-workflow 直接启动 pipeline，
  与 Agent _run_workflow_steps 的步骤确认流形成竞态。
  修法: 前端统一通过 WS user:message 触发 Agent，不再直接调 REST。
  关键词: start-workflow, 预确认门, Pipeline already running
```

## 八、验证清单（全部通过 = V3 目标达成）

| # | 验证项 | 方法 | 当前状态 |
|---|--------|------|----------|
| 1 | pytest | `.venv/bin/python -m pytest web/backend/tests/` | ✅ 16 passed |
| 2 | tsc | `npx tsc --noEmit` | ✅ 0 errors |
| 3 | 预确认门弹出 | 浏览器: 点击"开始创作" → 出现参数预览 | ✅ 已验证 |
| 4 | 预确认门阻塞执行 | WS E2E 测试: need_confirm_before → confirm → pipeline:status | ✅ 程序化验证通过 |
| 5 | DeepSeek 文本生成 | 后端日志: api.deepseek.com/v1 → 200 | ✅ 已验证 |
| 6 | 后确认门弹出 | 浏览器: 生成完成 → 审阅确认 | ✅ 已验证 |
| 7 | ChatPanel 双向同步 | WorkArea 确认 → ChatPanel disabled + 修改后执行 | ✅ B2 已修 |
| 8 | MOCK_MODE 保护 | 图片/视频不调阿里 API | ✅ 已实现 |
| 9 | 6 步完整流程 | WS E2E: create→connect→start_workflow→confirm_before→pipeline:status | ✅ 程序化验证通过 |
| 10 | 设计文档覆盖率 | 10/10 缺口全部实现 (P0/P1/P2 全覆盖) | ✅ ≈100% |

## 九、执行顺序

```
B1 修复 (P0, ~1h)
  │
  ├── maker-checker 自动验证
  ├── /reviewer 审查
  ├── 浏览器 E2E 验证
  └── STATUS.md + LEARNINGS.md 更新
      │
      ▼
B2 修复 (P2, ~20min) + 6 项偏差 (P2-P3, ~1h)
  │
  ├── maker-checker 自动验证
  └── STATUS.md 更新
      │
      ▼
全链路浏览器 E2E 验证 (~30min)
  │
  ├── 6 步流程完整通过
  ├── 截图存档
  └── Codex 最终分析
      │
      ▼
/triage → STATUS.md 最终状态
/learning → LEARNINGS.md 最终版
git commit → feature-v3-upgrade
```

---

> 基于 LOOPENGINEER.md v1.0 | 方法: /goal → hooks → /reviewer → /triage → /learning
