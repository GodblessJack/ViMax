# ViMax Web — LoopEngineer 使用指南

> 本文档是 LoopEngineer 开发基础设施的**用户手册**。
> 当你不确定如何用某个机制时，让 Claude Code 读这个文件，而非让它扫描全部代码重新发现。
>
> 配套文件：`CLAUDE.md`（项目规则）、`STATUS.md`（当前进度）、`LEARNINGS.md`（错误记忆）

---

## 一、概览：你拥有什么

LoopEngineer 在 ViMax Web 项目中部署了 **16 个文件**（项目级 14 + 全局 hooks 2），覆盖 6 大构建块：

```
                    ┌──────────────────────────────┐
                    │     loop.config.yaml          │  ← 刹车参数（改阈值在这里）
                    └──────────────────────────────┘
                                    │
        ┌───────────────┬───────────┴───────────┬───────────────┐
        ▼               ▼                       ▼               ▼
   SessionStart   PreToolUse            PostToolUse       Stop/StopFailure
        │               │                       │               │
        ▼               ▼                       ▼               ▼
  heartbeat-check  circuit-breaker        maker-checker   learning-capture
  (健康检查)       (5项刹车检查)          (pytest+tsc)    (错误捕获→inbox)
        │                                                       │
        ▼                                                       ▼
  STATUS.md 检查                                         .claude/learnings/
                                                        inbox/*.json
                                                                  │
                                                                  ▼
                                                          /learning skill
                                                                  │
                                                                  ▼
                                                           LEARNINGS.md
```

### 全局 Hooks（~/.claude/settings.json）

除了上述项目级 hooks，还有 **2 个全局 hooks** 对所有项目生效：

| 机制 | 类型 | 触发方式 | 做什么 |
|------|------|----------|--------|
| **auto-continue** | Stop hook | 任务在 tool_use 中途停止 | 自动续命最多 **5 次**（你看到的"第 1/5 次续命"就来自它），防死循环：相同输出放行、flock 锁防止并发 |
| **subagent-rules** | SubagentStart hook | 每次启动 subagent | 注入 Loop Engineering 元规则（fail-open、jq 验证、标注来源等），作为 CLAUDE.md 的补充 |

> **协作关系**：全局 hooks 处理通用的 Loop Engineering 安全机制，项目 hooks 处理 ViMax 特定的验证逻辑。两者事件类型不重叠，不会冲突。

### 所有可用机制速查

| 机制 | 类型 | 触发方式 | 做什么 |
|------|------|----------|--------|
| **CLAUDE.md** | 规则文件 | 自动加载 | 22 条项目铁律，每个 session 自动注入 |
| **LOOPENGINEER.md** | 本文档 | 手动 `Read` | LoopEngineer 使用说明 |
| **STATUS.md** | 状态文件 | PreCompact 检查 | Done/InProgress/Next/Never 四区追踪 |
| **LEARNINGS.md** | 记忆文件 | SessionStart 统计 | 10 Patterns + 11 Gotchas + 5 Fixes |
| **goal-prompt.md** | 模板 | 手动参考 | 如何写可验证的 /goal |
| **loop.config.yaml** | 刹车配置 | hooks 读取 | 120 turns, $3 budget, 5 circuit_breaker |
| **heartbeat-check** | SessionStart hook | 每次会话启动 | 检查 STATUS 活跃性/thrashing/inbox 积压 |
| **circuit-breaker** | PreToolUse hook | 每次 Write/Edit 前 | turn 计数/scope/分支/死循环检测 |
| **maker-checker** | PostToolUse hook | 每次 Write/Edit 后(异步) | pytest + tsc + 安全扫描 |
| **checkpoint** | PreCompact hook | 上下文压缩前 | 保存 git 状态快照 |
| **learning-capture** | StopFailure hook | API 错误/验证失败时 | 捕获错误到 inbox |
| **notify-slack** | Notification hook | permission_prompt 时 | Slack 通知(需配 webhook) |
| **/triage** | Skill | 手动 `/triage` | 故障分类 → 写入 STATUS.md Next |
| **/learning** | Skill | 手动 `/learning` | 处理 inbox → 提炼到 LEARNINGS.md |
| **reviewer** | Agent | 手动 `/reviewer` | 4 维度对抗性代码审查 |

---

## 二、快速上手：启动一个新任务

### 模板（复制即用）

```
/goal 修复 {问题描述}
必须满足:
1. cd web/backend && python -m pytest tests/ -x -q
2. cd web/frontend && npx tsc --noEmit
3. {你的手动验证步骤}

刹车: max_turns=40, budget=$1
```

### 实际操作流程

```
第 1 步：把上面模板填入你的需求 → 输入给 Claude Code
第 2 步：Claude 自动工作（hooks 在后台保护）
第 3 步：完成后检查 ──┬── maker-checker 验证结果
                      ├── STATUS.md 是否更新
                      └── LEARNINGS.md 是否有新发现
第 4 步：commit → 下一个任务
```

### 不想用 /goal？直接说需求也行

`/goal` 是推荐方式但非必须。即使你说"帮我修 WebSocket 断连的问题"，背后的 hooks 仍然在保护你：

- circuit-breaker 防止死循环
- maker-checker 每次写入后自动验证
- checkpoint 压缩前保存进度

### 一次典型 Session 的全貌

当你从 `web/` 目录启动 Claude Code 并开始工作时，背后发生：

```
SessionStart
  └── heartbeat-check.sh 运行
      ├── STATUS.md 健康 → ✅ 或 ⚠️
      ├── LEARNINGS.md 统计 → "10P 11G 5F"
      └── inbox 积压检查 → 建议 /learning (如 >5 条)

你输入需求 → Claude 开始工作
  │
  ├── 每次 Write/Edit 前
  │   └── circuit-breaker.sh
  │       ├── turns: 1/120
  │       ├── scope 检查 → 路径是否允许
  │       ├── 分支检查 → main 是否在 write_branches 中
  │       └── 死循环检测 → 连续 5 次同操作会警告
  │
  ├── 每次 Write/Edit 后（异步）
  │   └── maker-checker.sh
  │       ├── 改 backend/*.py → pytest
  │       ├── 改 frontend/src/*.ts → tsc --noEmit
  │       └── 改配置文件 → 安全扫描
  │       └── exit 0 (静默) 或 exit 2 (唤醒 Claude 报告失败)
  │
  ├── Subagent 启动时
  │   └── subagent-rules.sh (全局) → 注入元规则
  │
  ├── 上下文压缩前
  │   └── precompact-checkpoint.sh → 保存 git 状态快照
  │
  ├── 弹出 permission_prompt 时
  │   └── notify-slack.sh → Slack 通知 (需 webhook)
  │
  └── 任务在 tool_use 中途停止时
      └── auto-continue.sh (全局)
          ├── 检查是否有活跃 tool_use → 无则放行 (纯对话不续命)
          ├── 检查是否卡死 (相同输出连续) → 放行
          ├── 检查续命次数 (< 5) → block 续命
          └── 超过 5 次 → 放行停止
              └── 你看到: "任务尚未完成(本轮第 X/5 次续命)"
```

### 刹车触发时你看到什么

当 circuit-breaker 检测到异常时，stderr 输出会出现在你的终端（或 Claude Code 日志中）：

```
# 正常（无警告）
[circuit-breaker] turns: 23/120
[circuit-breaker] ✅ checks passed

# 死循环警告
[circuit-breaker] ⛔ circuit_breaker: 同一操作连续重复 5 次（≥5）
   操作: Write
   ⚠️ 检测到可能的死循环，建议检查 /goal 或手动介入

# 分支不在白名单
[circuit-breaker] ⚠️ 当前分支 experiment-x 不在 write_branches 允许列表中
```

heartbeat-check 在 SessionStart 时输出：

```
# 一切正常
[heartbeat] LEARNINGS.md: 10P 11G 5F
[heartbeat] ✅ 项目健康检查通过

# 有警告
[heartbeat] ⚠️ 发现问题:
  ⚠️ STATUS.md 300 分钟未更新（上限: 240）— 可能静默死亡
  💡 learning inbox 有 8 条 pending — 建议运行 /learning skill
```

## 三、决策指南：什么时候用什么

### "我该直接用 Claude 还是调用 skill/agent？"

```
你要做的事情                          用什么
──────────────────────────────────────────────────────────
写代码 / 修 bug / 加功能              直接对话（hooks 自动保护）
不确定当前项目状态                    看 STATUS.md
不确定这个错误以前修过没              看 LEARNINGS.md
新 session 启动后想知道项目健康状态    heartbeat-check 自动报告
代码写完了，想确认质量                /reviewer（对抗性审查）
连续修了几个 bug，想归类               /triage（故障分类）
看到 inbox 有积压                      /learning（提炼错误记忆）
任务太大，想设明确边界                 /goal（参考 goal-prompt.md）
想改刹车参数（预算、步数等）          编辑 loop.config.yaml
需要添加新的项目规则                  编辑 CLAUDE.md
修了一个新类型 bug，想记录下来        编辑 LEARNINGS.md
任务完成，更新进度                    编辑 STATUS.md
```

### "什么时候该更新 STATUS.md？"

每次完成一个 P0/P1 任务后，把该项从 `## 📋 Next` 移到 `## ✅ Done`，并更新顶部的 "最后更新" 时间戳。这很重要——heartbeat-check 依赖这个时间戳判断项目是否"静默死亡"。

### "什么时候该更新 LEARNINGS.md？"

当你修复了一个**新类型**的 bug，或者踩了一个**以前没见过的坑**。三个分类：
- 🔴 Patterns：同一个错误模式出现了 ≥2 次
- 🟡 Gotchas：技术栈特有的陷阱（出现一次就值得记录）
- 🟢 Fixes：验证过的修复配方（步骤清晰、可复现）

---

## 四、Hook 参考：什么时候触发，做什么

### SessionStart → heartbeat-check.sh
**触发**：每次新会话启动
**耗时**：< 1 秒
**检查**：
1. STATUS.md 是否超过 240 分钟未更新 → 警告"可能静默死亡"
2. In Progress 区域是否有 >3 个未完成项 → 警告"可能 thrashing"
3. learning inbox 是否有 >5 条 pending → 建议运行 /learning
4. LEARNINGS.md 统计 → 输出 (例: "10P 11G 5F")
**失败策略**：任何错误 exit 0，不阻塞

### PreToolUse → circuit-breaker.sh
**触发**：每次 Write / Edit / NotebookEdit 调用前
**耗时**：~100-200ms（含 python3 YAML 解析）
**检查**：
1. Turn 计数（当前/上限）
2. 写入路径是否在 scope 白名单
3. 当前分支是否在 write_branches 允许列表
4. 连续 5 次相同 tool+input → 死循环警告
**失败策略**：只警告不阻塞（fail-open）

### PostToolUse → maker-checker.sh
**触发**：每次 Write / Edit / NotebookEdit 调用后（**异步**执行）
**耗时**：pytest ~30s, tsc ~3s（不阻塞主流程）
**检查**：
1. 修改 `backend/*.py` → 自动跑 pytest
2. 修改 `frontend/src/*.ts` → 自动跑 tsc --noEmit
3. 修改配置文件 → 安全扫描（硬编码密钥检测）
**失败策略**：exit 2 → asyncRewake 唤醒 Claude 报告失败

### PreCompact → precompact-checkpoint.sh
**触发**：上下文压缩前
**耗时**：< 1 秒
**作用**：保存 checkpoint JSON 到 `.claude/checkpoints/`（branch, commit, 修改文件列表），保留最近 30 个。用于中断后恢复上下文
**失败策略**：exit 0

### StopFailure → learning-capture.sh
**触发**：API 错误导致停止 / PostToolUse exit 2 验证失败
**耗时**：< 1 秒
**作用**：写入结构化错误 JSON 到 `.claude/learnings/inbox/`
**防抖**：相同错误 10 分钟内不重复捕获
**失败策略**：exit 0

---

## 五、Skill 参考

### /triage —— 故障分类

**用途**：每天开始工作（或 SessionStart 自动提醒时），收集故障、分类、写入 STATUS.md Next。

**命令**：`/triage`

**做什么**：
1. 运行 pytest 看最新测试状态
2. 扫描 learnings inbox
3. 分类为 P0/P1/P2
4. 写入 STATUS.md Next 区域
5. 更新 STATUS.md 时间戳

**不做什么**：不修代码（Maker ≠ Checker）

### /learning —— 错误记忆提炼

**用途**：当 inbox 有 pending 错误时，分析并提炼到 LEARNINGS.md。

**命令**：`/learning`

**做什么**：
1. 扫描 `.claude/learnings/inbox/` 中 status=pending 的项
2. 分析症状、根因
3. 分类为 Patterns / Gotchas / Fixes
4. 写入 LEARNINGS.md（去重、最多 150 字/条）
5. 标记 inbox 项为 processed

**不做什么**：不记录琐碎项（拼写错误等），不超过 10 条/次

---

## 六、Agent 参考

### reviewer —— 对抗性代码审查

**用途**：代码变更完成后，获得独立的、对抗性的审查意见。

**用法**：
```
请用 reviewer agent 审查最近的 git diff
```

**审查维度**：
1. Correctness — WebSocket 前后端一致性、Zustand 状态完整性、Python async 正确性
2. Security — API 鉴权、Agent tool 输入验证、路径注入
3. Architecture — 双向平权架构一致性、是否绕过 ConfirmationGate
4. Edge Cases — session 不存在、pipeline 中断、并发冲突

**判决**：Approve / Changes Requested / Block

**约束**：不写修复代码，不评论风格，中文输出，有疑问倾向于 Block

---

## 七、常见工作流模式

### 模式 1：修 Bug

```
1. 查 LEARNINGS.md → 同类 bug 以前修过吗？
2. /goal 修复 B{n} bug
3. Claude 修代码（hooks 在背后保护）
4. maker-checker 自动验证 → 通过或失败
5. /reviewer ← 对抗性审查
6. 更新 STATUS.md（移到 Done）
7. 如果新类型 bug → 更新 LEARNINGS.md
8. git commit
```

### 模式 2：加新功能

```
1. STATUS.md 确认 Next 优先级
2. /goal 实现 {功能}
3. Claude 开发 + hooks 保护
4. maker-checker 验证
5. 手动在浏览器测试
6. /reviewer 审查
7. 更新 STATUS.md + goal-prompt.md（如果发现更好的 goal 写法）
8. git commit
```

### 模式 3：日常启动

```
1. 打开 Claude Code（web/ 目录）
2. heartbeat-check 自动报告项目状态
3. 看 STATUS.md → 挑一个 Next 项
4. 如果 inbox 有积压 → /learning
5. 如果 LEARNINGS 有相关陷阱 → 注意避免
6. 开始工作
```

### 模式 4：全链路验证

```
1. /goal 端到端验证
2. backend pytest + frontend tsc
3. 启动 backend + frontend
4. 手动测试完整 6 步工作流
5. maker-checker 全绿
6. 更新 STATUS.md + heartbeat 时间戳
```

---

## 八、配置调优

### 改刹车参数

编辑 `loop.config.yaml`：

```yaml
brakes:
  max_turns: 120        # 调到 60 收紧，200 放宽
  max_budget_usd: 3     # DeepSeek 定价极低，$3 跑很久
  circuit_breaker: 5    # 调到 3 更敏感，10 更宽松
  heartbeat_max_age_min: 240  # STATUS.md 未更新多久后警告
```

### 添加新的项目规则

编辑 `CLAUDE.md`，在对应铁律分类下添加。CLAUDE.md 会被每个 session 和 subagent 自动加载。

### 添加新的错误记忆

编辑 `LEARNINGS.md`，三种情况：
- 同一个坑踩了两次 → 🔴 Patterns
- 第一次遇到但别人可能踩 → 🟡 Gotchas
- 完整的修复步骤 → 🟢 Fixes

### 配置 Slack 通知

1. 在 Slack 创建 Incoming Webhook
2. 填入 `loop.config.yaml` 的 `notifications.slack_webhook_url`
3. 或 `export SLACK_WEBHOOK_URL="https://hooks.slack.com/..."`

---

## 九、故障排查

| 症状 | 可能原因 | 解法 |
|------|----------|------|
| hooks 不触发 | `web/.claude/settings.json` 未被加载 | 检查 Claude Code 是否从 web/ 启动 |
| maker-checker 不跑 pytest | async hook 超时 | pytest 命令自带 `--timeout=60` |
| circuit-breaker 误报 main 分支 | `write_branches` 不含 main | 检查 `loop.config.yaml` 的 write_branches |
| heartbeat-check 报 thrashing | In Progress 区域 >3 项 | 检查 STATUS.md，完成或降低 WIP |
| learning-capture 不工作 | jq 或 md5sum 缺失 | `which jq md5sum` |
| notify-slack 不发消息 | webhook URL 未配置 | 设置 `SLACK_WEBHOOK_URL` 或填写 loop.config.yaml |
| inbox 堆积 | 没运行 /learning | 手动运行 `/learning` |
### checkpoint 恢复

PreCompact hook 保存快照到 `.claude/checkpoints/`，每个 JSON 文件包含：
```json
{
  "branch": "fix/ws-reconnect",
  "commit": "3c0d3ae",
  "commit_message": "fix(ws): suppress reconnect noise",
  "modified_files": "web/backend/routers/ws.py,web/frontend/src/hooks/useSessionWebSocket.ts"
}
```

如果 session 中断后需要恢复：
1. 查看最新 checkpoint: `ls -lt .claude/checkpoints/ | head -3`
2. 切换到记录的 branch + commit
3. 检查 modified_files 列表 → 确认哪些文件需要关注

checkpoint 保留最近 30 个，旧的自动清理。

### 如何验证 Hooks 正常工作

如果怀疑某个 hook 没有在执行，手动注入测试 JSON：

```bash
# 测试 heartbeat-check
echo '{"session_id":"test"}' | bash .claude/hooks/heartbeat-check.sh

# 测试 circuit-breaker
echo '{"tool_name":"Write","tool_input":{"file_path":"web/backend/config.py"},"session_id":"test"}' | bash .claude/hooks/circuit-breaker.sh

# 测试 maker-checker (前端 TS 检查，较快)
echo '{"tool_name":"Edit","tool_input":{"file_path":"web/frontend/src/App.tsx"}}' | bash .claude/hooks/maker-checker.sh

# 测试 checkpoint
echo '{"session_id":"test"}' | bash .claude/hooks/precompact-checkpoint.sh

# 测试 learning-capture
echo '{"hook_event":"StopFailure","exit_code":"1","reason":"test error"}' | bash .claude/hooks/learning-capture.sh
```

### 如何临时禁用某个 Hook

编辑 `web/.claude/settings.json`，从对应事件中**删除或注释**该 hook 条目。例如禁用 circuit-breaker：

```json
"PreToolUse": []   // 空数组 = 不执行任何 PreToolUse hook
```

或只保留想用的 hook。**改后 JSON 必须验证**：`python3 -m json.tool .claude/settings.json > /dev/null`。

### 如何完全停止自动续命

如果 auto-continue（"续命"）打扰你，临时停止的方式：在消息中明确说"任务已完成"或"请停止"。auto-continue 只在检测到活跃 tool_use 时才续命——如果你只是在对话（无工具调用），它不会触发。

---

## 十、与 CLAUDE.md 的分工

| CLAUDE.md | LOOPENGINEER.md |
|-----------|-----------------|
| **做什么**：项目技术规则 | **怎么做**：开发方法和流程 |
| 代码怎么写 | 任务怎么启动 |
| 不能做什么 | 应该用什么机制 |
| 架构约束 | 工作流模式 |
| 自动加载到每个 session | 需要时手动 Read |

如果 Claude 问你 "怎么用 /goal？" 或 "有哪些 hook？" —— 让它 `Read web/LOOPENGINEER.md`。

---

> 最后更新: 2026-06-22 | LoopEngineer 版本: v1.0 | 适用于 ViMax Web 项目
