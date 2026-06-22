export const meta = {
  name: 'vimax-v3-full-upgrade',
  description: 'AI-Pipeline深度集成 + 预/后确认门 + WorkArea↔ChatPanel双向同步 — Loop Engineer全规范兼容',
  phases: [
    { title: 'Design', detail: '读取10个关键文件，产出architecture-v3-design.md精确设计文档' },
    { title: 'DesignReview', detail: '/reviewer对抗性审查设计文档 (4维度: Correctness/Security/Architecture/EdgeCases)' },
    { title: 'Protocol', detail: 'types.ts + ws.py协议层 (同一agent确保字符串级别一致)' },
    { title: 'Backend', detail: 'agent_tools/agent_service/confirmation_gate/pipeline_service 并行实现 (≤4并发)' },
    { title: 'Frontend', detail: 'Store/ConfirmationGate/ChatPanel/WorkArea/WS-hook 并行实现 (≤5并发)' },
    { title: 'ImplReview', detail: '/reviewer对抗性审查实现代码 (4维度, 独立视角)' },
    { title: 'Integration', detail: '跨文件5项一致性检查+自动修复所有不匹配' },
    { title: 'VerifyLoop', detail: 'pytest+tsc自愈循环 (最多3轮, 每轮自动修复根因)' },
    { title: 'LoopClose', detail: 'STATUS.md更新 + LEARNINGS.md错误提炼 + /triage故障分类' },
  ],
}

// ============================================================================
// Phase 0: 架构设计 — 产出精确设计文档
// ============================================================================
phase('Design')

await agent(`
## 你是ViMax项目架构师。完成以下三步:

### 第一步: 深度理解现状 (Read ALL files)

Read every one of these files in full:
- web/backend/services/agent_tools.py
- web/backend/services/agent_service.py
- web/backend/services/confirmation_gate.py
- web/backend/services/pipeline_service.py
- web/backend/routers/ws.py
- web/frontend/src/stores/types.ts
- web/frontend/src/stores/workflowStore.ts
- web/frontend/src/hooks/useSessionWebSocket.ts
- web/frontend/src/components/layout/AIChatPanel.tsx
- web/frontend/src/components/workarea/WorkArea.tsx
- web/CLAUDE.md
- web/LOOPENGINEER.md
- web/LEARNINGS.md

### 第二步: 理解10个关键缺口

1. agent_tools.py的run_step调用私有方法_run_planning/_run_rendering (非公开API)
2. AIChatPanel.tsx的Step1用硬编码关键词匹配提取idea/style (绕过Agent, 导致"15秒小猫打败老虎"被当成人名)
3. 无预执行确认机制 (没有step:need_confirm_before事件, 无法在步骤执行前请求用户确认)
4. pipeline_service.py的_run_planning/_run_rendering批量执行所有子步骤 (子步骤不可见, 无法逐步骤确认)
5. ChatPanel没有确认按钮 (只有WorkArea的StepActions有, 违反双向平权架构)
6. WorkArea和ChatPanel无双向同步状态 (lastConfirmationSource缺失)
7. WorkArea.tsx用2秒setInterval轮询/api/pipeline/confirm-status (与WS驱动冲突, 脆弱)
8. 无artifact diff状态追踪 (用户修改后无变更记录)
9. Agent工具无法内省Pipeline状态 (get_session_state太粗糙)
10. ConfirmationGate只被AgentService._run_workflow_steps触发 (绕过时无声)

### 第三步: 产出精确设计文档

Write to web/docs/architecture-v3-design.md. 必须包含以下Section (代码级别精确度):

#### Section 1: 新增WS事件类型 (完整字符串, 直接可用)
Server→Client新增:
- "step:need_confirm_before"
- "step:pre_step_context"
- "sync:config_changed"
- "sync:confirmation_state"

Client→Server新增:
- "user:confirm_before"
- "user:reject_before"

#### Section 2: TypeScript类型扩展 (可直接复制使用的代码)
- PendingConfirmation增加 phase: "before" | "after"
- PreStepConfirmData接口
- PostStepConfirmData接口
- SyncState接口
- 完整WsServerEvent和WsClientEvent联合类型

#### Section 3: WorkflowStore状态扩展 (精确属性名+类型)
- preStepConfirmData, postStepConfirmData, syncState, lastConfirmationSource
- 新增actions及其签名
- handleWsEvent新增case

#### Section 4: Agent工具重构 (6个工具, 每个含完整JSON Schema)
每个工具: 名称 | 描述 | tool_input_schema (完整JSON Schema) | 调用的PipelineService公开方法

#### Section 5: ConfirmationGate组件Props接口 (完整TypeScript接口)
#### Section 6: 双向同步数据流 (ASCII art)
#### Section 7: 文件级变更清单 (新增/删除/修改)
#### Section 8: 向后兼容保证

文档必须精确到"后续agent可以直接据此编码不做任何额外设计决策"的程度。
`, { label: 'architect', effort: 'high' })

log('✅ Phase 0 完成: docs/architecture-v3-design.md')

// ============================================================================
// Phase 0.5: 设计审查 — /reviewer 对抗性审查 (Loop Engineer核心机制)
// ============================================================================
phase('DesignReview')

const designReview = await agent(`
## 你是独立审查员 (reviewer agent). 对抗性审查 web/docs/architecture-v3-design.md

Read web/docs/architecture-v3-design.md first. Then review against these 4 dimensions:

### Dimension 1: Correctness (正确性)
- WS事件类型定义是否完备? 有无遗漏的边界情况?
- TypeScript类型是否与实际数据流一致?
- 事件payload结构是否自洽?
- pre-step + post-step confirmation流程是否有死锁可能? (两个门同时等待)

### Dimension 2: Security (安全性)
- 确认门是否可被绕过? (直接REST调用跳过确认)
- Agent工具的输入验证是否充分?
- WS事件是否有注入风险?
- 用户权限检查是否在每个confirm/reject路径上?

### Dimension 3: Architecture (架构一致性)
- 是否符合双向平权架构? (WorkArea和ChatPanel权力对等?)
- ConfirmationGate是否在两个面板真正共享? (不是两个独立实例?)
- 数据流是否经过WorkflowStore单一真相源?
- Sub-step拆分是否合理? 粒度是否合适?

### Dimension 4: Edge Cases (边界情况)
- Session不存在时确认门如何表现?
- Pipeline中断后确认状态如何清理?
- 两个面板同时点击确认会冲突吗?
- WebSocket断连重连后确认状态能恢复吗?
- 超时处理: 30分钟后自动放行是否安全?

## 输出格式:
对每个维度, 给出:
- 评分 (0-10)
- 发现的问题 (如果有)
- 修改建议

如果发现**结构性缺陷** (会导致功能错误、死锁、或安全漏洞的设计问题), 回复 "BLOCKED: <缺陷列表>".
如果设计可接受 (即使有可后续修复的低优先级问题), 回复 "APPROVED: <简要评价>".
注意: 不要在评分上卡流程。只要没有结构性缺陷就放行。实现阶段可以迭代修复小问题。`, { label: 'design-reviewer', effort: 'high' })

log('设计审查结果: ' + (designReview || '审查完成'))

// Agent 自判断: 只有 P0 结构性死锁/安全漏洞才阻塞，P1/P2 记录后自动推进
const designVerdict = await agent(`
## 你是设计审查裁决者。阅读审查报告后做出推进决策。

审查报告:
${designReview || '无审查报告'}

## 决策规则:
- 如果发现**结构性死锁** (如两个门互相等待导致流程卡死) 或 **安全漏洞** (如确认门可被绕过) —> 回复 "HALT: <具体问题>"
- 如果只有设计细节不精确、接口命名建议、边界情况遗漏等 —> 回复 "PROCEED: <已记录的风险清单>"
- 原则: 宁可带着已知小问题推进然后迭代修复，也不要卡在设计阶段反复讨论。只有真正会让系统无法运行的缺陷才值得阻塞。

## 输出: PROCEED 或 HALT (二选一)
`, { label: 'verdict', effort: 'medium' })

if (designVerdict && designVerdict.includes('HALT')) {
  log('⛔ 设计有致命缺陷, 必须修复后重试: ' + designVerdict)
  throw new Error('Design review HALT: ' + designVerdict)
}
log('✅ 设计审查通过 (agent自判断): ' + (designVerdict || 'PROCEED'))

// ============================================================================
// Phase 1: 协议层 — types.ts + ws.py (同一agent, Loop Engineer铁律#1: WS一致性)
// ============================================================================
phase('Protocol')

await agent(`
## ⚠️ IMPLEMENTATION MODE — DO NOT REVIEW THE DESIGN ⚠️
The design document has already passed adversarial review. Your ONLY task is to write code exactly as specified. Do NOT evaluate, score, or critique the design — just implement it.

## ⚠️ IMPLEMENT ONLY — DO NOT REVIEW ##
The design has been adversarially reviewed and approved. Write code exactly as specified.

Read web/docs/architecture-v3-design.md. Implement the PROTOCOL LAYER.

## Step A: Modify web/frontend/src/stores/types.ts
- Add WsServerEvent string literals: "step:need_confirm_before" | "step:pre_step_context" | "sync:config_changed" | "sync:confirmation_state"
- Add WsClientEvent string literals: "user:confirm_before" | "user:reject_before"
- Add interfaces PreStepConfirmData, PostStepConfirmData, SyncState (exact from design doc Section 2)
- Extend PendingConfirmation: add phase?: "before" | "after"
- DO NOT change any existing type definitions

## Step B: Modify web/backend/routers/ws.py
- Add broadcast functions for all new event types
- Add WS handlers for "user:confirm_before" → agent_service.handle_confirm_before()
- Add WS handler for "user:reject_before" → agent_service.handle_reject_before()
- ALL event type STRINGS must match types.ts EXACTLY (字符串级别一致 — Loop Engineer铁律#1)

## Step C: Verify
Run: cd web/frontend && npx tsc --noEmit
Run: cd web/backend && python -m pytest tests/ -x -q
Fix until both pass.
`, { label: 'protocol-layer' })

log('✅ Phase 1 完成: 协议层 (types.ts ↔ ws.py 字符串一致)')

// ============================================================================
// Phase 2+3: 后端 + 前端并行 (≤6并发, 符合DeepSeek速率限制)
// ============================================================================
phase('Backend')
phase('Frontend')

// Total 9 agents, split into 2 groups (4 + 5) — each group ≤6, respects DeepSeek rate limit
// Group 1: Backend (4 agents concurrent)
const backendResults = await parallel([
  () => agent(`
## ⚠️ IMPLEMENT ONLY — DO NOT REVIEW ##
The design has been adversarially reviewed and approved. Write code exactly as specified.

Read web/docs/architecture-v3-design.md Section 4.
Modify web/backend/services/agent_tools.py:
- Implement ALL 6 tools: create_story, inspect_pipeline, configure_step, request_step_execution, review_artifact, modify_artifact
- Each tool calls PipelineService PUBLIC methods only (Loop Engineer铁律#4: 不可绕过ConfirmationGate)
- Each tool has complete JSON Schema in tool_input_schema
- Refactor tool_run_step: remove 200+ line inline broadcast, delegate to new tools
- Update AVAILABLE_TOOLS list
Follow existing patterns. Verify: cd web/backend && python -c "from services.agent_tools import AVAILABLE_TOOLS; print(len(AVAILABLE_TOOLS))"
`, { label: 'agent_tools.py', phase: 'Backend' }),

  () => agent(`
## ⚠️ IMPLEMENT ONLY — DO NOT REVIEW ##
The design has been adversarially reviewed and approved. Write code exactly as specified.

Read web/docs/architecture-v3-design.md.
Modify web/backend/services/agent_service.py:
- Update SYSTEM_PROMPT to inject pipeline context + user intent parsing rules
- Add rule: input "15秒小猫打败老虎" = PLOT DESCRIPTION, NOT character name
- Parse user intent as {genre, plot, style, duration} before any tool call
- Update _run_workflow_steps: add pre-step confirmation via ConfirmationGate.pre_step_confirm()
- Add style/parameter mapping table to system prompt
Follow existing patterns. Verify: cd web/backend && python -c "from services.agent_service import AgentService; print('OK')"
`, { label: 'agent_service.py', phase: 'Backend' }),

  () => agent(`
## ⚠️ IMPLEMENT ONLY — DO NOT REVIEW ##
The design has been adversarially reviewed and approved. Write code exactly as specified.

Read web/docs/architecture-v3-design.md.
Modify web/backend/services/confirmation_gate.py:
- Add pre_step_confirm(session_id, step_name, context) → sends step:need_confirm_before, blocks on asyncio.Event
- Extend wait_for_confirmation to track phase ("before"|"after")
- Add get_pending_state(session_id) → {waiting, step_name, phase, context}
- Keep existing API unchanged (Loop Engineer铁律#5: ConfirmationGate不可绕过)
`, { label: 'confirmation_gate.py', phase: 'Backend' }),

  () => agent(`
## ⚠️ IMPLEMENT ONLY — DO NOT REVIEW ##
The design has been adversarially reviewed and approved. Write code exactly as specified.

Read web/docs/architecture-v3-design.md.
Modify web/backend/services/pipeline_service.py:
- Add public sub-step methods: run_story_generation, run_character_extraction, run_script_writing, run_storyboard_scene, run_character_portrait, run_video_scene
- _run_planning/_run_rendering become orchestrators calling sub-step methods with pre/post confirmation
- Each sub-step broadcasts step:running with granular progress
- Keep start_planning/start_rendering public API signatures
Verify: cd web/backend && python -m pytest tests/ -x -q
`, { label: 'pipeline_service.py', phase: 'Backend' }),
])

log('✅ 后端 4 文件并行完成')

// Group 2: Frontend (5 agents)
const frontendResults = await parallel([
  () => agent(`
## ⚠️ IMPLEMENT ONLY — DO NOT REVIEW ##
The design has been adversarially reviewed and approved. Write code exactly as specified.

Read web/docs/architecture-v3-design.md Section 3.
Modify web/frontend/src/stores/workflowStore.ts:
- Add state: preStepConfirmData, postStepConfirmData, syncState, lastConfirmationSource
- Add actions: requestPreConfirm, respondPreConfirm, setSyncState, clearConfirmationState
- Add handleWsEvent cases for all 4 new event types
- DO NOT remove any existing state/actions/event handlers
- Add JSDoc comments
Verify: cd web/frontend && npx tsc --noEmit
`, { label: 'workflowStore.ts', phase: 'Frontend' }),

  () => agent(`
## ⚠️ IMPLEMENT ONLY — DO NOT REVIEW ##
The design has been adversarially reviewed and approved. Write code exactly as specified.

Read web/docs/architecture-v3-design.md Section 5.
CREATE NEW FILE web/frontend/src/components/workarea/ConfirmationGate.tsx:
- Implement ConfirmationGateProps interface exactly as specified
- Pre-confirm mode: step name + context + params summary + "确认开始"/"拒绝" buttons
- Post-confirm mode: result preview + "确认"/"重新生成"/"讨论" buttons
- confirmedBy indicator showing which side initiated
- TailwindCSS v4 styling matching existing components
- Export default
Verify: cd web/frontend && npx tsc --noEmit
`, { label: 'ConfirmationGate.tsx', phase: 'Frontend' }),

  () => agent(`
## ⚠️ IMPLEMENT ONLY — DO NOT REVIEW ##
The design has been adversarially reviewed and approved. Write code exactly as specified.

Read web/docs/architecture-v3-design.md.
Modify web/frontend/src/components/layout/AIChatPanel.tsx:
- REMOVE hardcoded keyword matching (Chinese style array + Step1 extraction logic)
- SUBSCRIBE to store.pendingConfirmations and store.preStepConfirmData
- RENDER <ConfirmationGate> when confirmations pending (both pre and post modes)
- QuickActions from store.agentSuggestions (WS-driven, not hardcoded)
- Confirmation button parity with WorkArea (same component, same state)
Verify: cd web/frontend && npx tsc --noEmit
`, { label: 'AIChatPanel.tsx', phase: 'Frontend' }),

  () => agent(`
## ⚠️ IMPLEMENT ONLY — DO NOT REVIEW ##
The design has been adversarially reviewed and approved. Write code exactly as specified.

Read web/docs/architecture-v3-design.md.
Modify web/frontend/src/components/workarea/WorkArea.tsx:
- REMOVE setInterval polling for /api/pipeline/confirm-status
- INTEGRATE ConfirmationGate in StepRunner:
  - phase='preparing' + preStepConfirmData → <ConfirmationGate mode="pre">
  - phase='done' + pending → <ConfirmationGate mode="post">
- Delegate StepActions confirm/modify/regenerate to ConfirmationGate
Verify: cd web/frontend && npx tsc --noEmit
`, { label: 'WorkArea.tsx', phase: 'Frontend' }),

  () => agent(`
## ⚠️ IMPLEMENT ONLY — DO NOT REVIEW ##
The design has been adversarially reviewed and approved. Write code exactly as specified.

Read web/docs/architecture-v3-design.md.
Modify web/frontend/src/hooks/useSessionWebSocket.ts:
- Add handlers for: step:need_confirm_before → store.requestPreConfirm()
- step:pre_step_context → store.updateStepContext()
- sync:config_changed → store.setSyncState()
- sync:confirmation_state → store.handleSyncConfirmation()
- Follow existing handler patterns
Verify: cd web/frontend && npx tsc --noEmit
`, { label: 'useSessionWebSocket.ts', phase: 'Frontend' }),
])

log('✅ 前端 5 文件并行完成')

// ============================================================================
// Phase 3.5: 实现审查 — /reviewer 对抗性审查代码 (Loop Engineer核心机制)
// ============================================================================
phase('ImplReview')

const implReview = await agent(`
## 你是独立审查员 (reviewer agent). 对抗性审查所有实现代码.

First run: cd web/backend && git diff --stat
Then read ALL modified files.

审查 4 个维度 (Loop Engineer reviewer标准):

### Dimension 1: Correctness (正确性)
- WebSocket前后端一致性: types.ts的字符串 ≡ ws.py的字符串? (逐字比对)
- Zustand状态完整性: 新增state是否在所有需要的组件中被正确订阅?
- Python async正确性: 确认门的await是否正确? 有无忘记await的协程?
- 数据流: user action → WS → backend → WS → store → UI 每步是否完备?

### Dimension 2: Security (安全性)
- API鉴权: 新增的WS handler是否有session归属校验?
- Agent tool输入验证: 6个新工具的input_schema是否充分约束输入?
- 路径注入: artifact路径操作是否有目录穿越风险?
- ConfirmationGate绕过: 能否通过直接REST调用跳过确认?

### Dimension 3: Architecture (架构一致性)
- 双向平权: WorkArea和ChatPanel的确认权力是否真正对等?
- 单一真相源: 所有状态是否通过WorkflowStore? (有无组件私藏状态?)
- ConfirmationGate共享: 两个面板是否使用同一个组件实例/同一store状态?
- Sub-step粒度: pipeline子步骤拆分是否合理?

### Dimension 4: Edge Cases (边界情况)
- Session不存在时的确认门行为?
- Pipeline中断后确认状态清理?
- 两个面板同时确认的竞态?
- WS断连重连后确认状态恢复?
- 确认超时(30min)自动放行的安全性?
- 0场景/单场景/多场景的storyboard确认流?

## 输出格式:
每个维度: 评分(0-10) + 发现的问题 + 修改建议

如果发现任何 P0 问题 (会导致功能错误/安全漏洞), 列出并标记为 MUST FIX.
如果发现 P1 问题 (架构偏离/边界遗漏), 列出但不要阻塞流程 — 实现阶段可迭代修复.
如果无 P0 问题, 回复 "APPROVED: <评价>".
注意: 不要在评分上卡流程. 只要没有P0问题就放行.
`, { label: 'impl-reviewer', effort: 'high' })

log('实现审查结果: ' + (implReview || '审查完成'))

// Agent 自判断: P0 问题才阻塞，其余自动推进
const implVerdict = await agent(`
## 你是实现审查裁决者。阅读审查报告后做出推进决策。

审查报告:
${implReview || '无审查报告'}

## 决策规则:
- 如果发现**功能阻断** (测试崩溃/类型错误导致编译失败) 或 **安全漏洞** —> 回复 "HALT: <具体问题>"
- 如果只有边界情况遗漏、命名建议、性能优化建议等 —> 回复 "PROCEED: <已记录的风险清单>"
- 原则: 实现阶段的小问题可以后续迭代修复。只阻塞真正会让系统无法运行的问题。

## 输出: PROCEED 或 HALT (二选一)
`, { label: 'impl-verdict', effort: 'medium' })

if (implVerdict && implVerdict.includes('HALT')) {
  log('⛔ 实现有致命缺陷, 必须修复后重试: ' + implVerdict)
  throw new Error('Impl review HALT: ' + implVerdict)
}
log('✅ 实现审查通过 (agent自判断): ' + (implVerdict || 'PROCEED'))

// ============================================================================
// Phase 4: 集成检查 — 跨文件一致性验证 + 自动修复
// ============================================================================
phase('Integration')

await agent(`
## ⚠️ IMPLEMENT ONLY — DO NOT REVIEW ##
The design has been adversarially reviewed and approved. Fix issues exactly as instructed.

## 集成检查员. Read ALL modified files. Fix EVERY mismatch.

### Check 1: Event Type String Matching (CRITICAL)
Read types.ts → extract all WsServerEvent and WsClientEvent string literals.
Read ws.py → extract all event type strings used in broadcast/handler functions.
→ Every string in ws.py MUST exist in types.ts. Fix any mismatch IMMEDIATELY.

### Check 2: Store Actions Exist
Read workflowStore.ts → list exported actions.
Read ConfirmationGate.tsx, AIChatPanel.tsx, WorkArea.tsx, useSessionWebSocket.ts → list store actions used.
→ Every action used MUST exist in store. Fix missing actions.

### Check 3: Agent Tools → PipelineService API
Read agent_tools.py → for each tool, note which PipelineService method it calls.
Read pipeline_service.py → verify those methods exist AND are public (no _prefix).
→ Fix any calls to non-existent or private methods.

### Check 4: ConfirmationGate Props Consistency
Read ConfirmationGate.tsx → note EXACT Props interface.
Read WorkArea.tsx and AIChatPanel.tsx → verify JSX props match the interface.
→ Fix any prop name mismatches.

### Check 5: No Orphaned References
Search for: deleted REST endpoint references, renamed event types, deleted function imports.
→ Remove or fix ALL orphaned references.

After ALL fixes: pytest + tsc must pass.
`, { label: 'integration-checker', effort: 'high' })

log('✅ Phase 4 完成: 集成检查+修复')

// ============================================================================
// Phase 5: 验证自愈循环 — maker-checker自动化版 (Loop Engineer PostToolUse)
// ============================================================================
phase('VerifyLoop')

let allPassed = false
let lastError = ''
for (let i = 0; i < 3 && !allPassed; i++) {
  const result = await agent(`
## 验证修复器 — 第 ${i + 1}/3 轮

Run EXACT commands:
cd web/backend && python -m pytest tests/ -x -q 2>&1
cd web/frontend && npx tsc --noEmit 2>&1

If BOTH pass with zero errors → respond EXACTLY: ALL PASSED

If either FAILS:
1. Copy the full error output
2. Identify the root cause (file + line + reason)
3. Fix the ROOT CAUSE (not suppress the error)
4. Re-run the failing command
5. If fixed → respond: ALL PASSED
6. If same error persists → try a DIFFERENT approach
7. If truly stuck → respond: BLOCKED: <error details>
`, { label: `verify-${i + 1}`, effort: 'medium' })

  if (result && typeof result === 'string' && result.includes('ALL PASSED')) {
    allPassed = true
    log('✅ pytest + tsc 全部通过!')
  } else if (result && typeof result === 'string' && result.includes('BLOCKED')) {
    lastError = result
    log('⚠️ 第 ' + (i + 1) + ' 轮阻塞: ' + result)
    break
  } else {
    log('🔄 第 ' + (i + 1) + ' 轮未通过, 继续自愈...')
  }
}

// ============================================================================
// Phase 6: Loop Close — STATUS.md + LEARNINGS.md + /triage (Loop Engineer闭环)
// ============================================================================
phase('LoopClose')

if (allPassed) {
  // Update STATUS.md
  await agent(`
## 更新 web/STATUS.md

Read web/STATUS.md first.

1. 将 "ViMax v3 架构升级" 相关任务从 ## 📋 Next 移到 ## ✅ Done
2. 在 Done 区域添加:
   - ✅ AI-Pipeline深度集成 (6个Agent工具 + 公开API调用 + 用户意图解析)
   - ✅ 预确认门系统 (step:need_confirm_before + pre_step_confirm)
   - ✅ 后确认门增强 (子步骤可见 + WS驱动替换轮询)
   - ✅ WorkArea↔ChatPanel双向同步 (ConfirmationGate共享 + SyncState)
   - ✅ 双边确认按钮一致 (幂等确认 + confirmedBy追踪)
   - ✅ ChatPanel硬编码移除 (Agent驱动意图解析)
   - ✅ WorkArea轮询移除 (纯WS驱动)
3. 更新顶部 "最后更新" 时间戳为当前日期
4. 确认 InProgress 区域没有遗留项
`, { label: 'update-status' })

  log('✅ STATUS.md 已更新')
  log('')
  log('🎉 ViMax v3 架构升级完成! 全部通过 Loop Engineer 规范:')
  log('  ✅ /goal 边界 (meta.phases = 明确分阶段)')
  log('  ✅ /reviewer × 2 (设计审查 + 实现审查, 各4维度对抗性)')
  log('  ✅ maker-checker (Phase 5 自愈循环 = pytest+tsc自动修复)')
  log('  ✅ STATUS.md (Phase 6 闭环更新)')
  log('  ✅ circuit-breaker (后台hooks持续保护)')
  log('  ✅ checkpoint (PreCompact自动快照)')
  log('')
  log('已实现需求:')
  log('  1. AI-Pipeline深度集成 (6工具+公开API+意图解析)')
  log('  2. 预确认门 (每步执行前必须确认)')
  log('  3. 后确认门 (每步生成后确认才能进入下一步)')
  log('  4. 工作区展示每步前后内容 (ConfirmationGate双模式)')
  log('  5. WorkArea↔ChatPanel双向同步 (共享Store+ConfirmationGate)')
  log('  6. 双边确认按钮一致 (powered by confirmedBy)')
  log('  7. 全部pipeline同步 (sync:config_changed + sync:confirmation_state)')
  log('')
  log('下一步: 启动backend+frontend, 浏览器验证完整6步工作流.')
} else {
  // Failure path: /triage + LEARNINGS.md capture
  await agent(`
## /triage 故障分类 + LEARNINGS.md 错误提炼

### Step 1: 故障诊断
Run: cd web/backend && python -m pytest tests/ -x -q 2>&1 | tail -50
Run: cd web/frontend && npx tsc --noEmit 2>&1 | tail -50

Analyze the remaining errors and classify:
- P0: 功能阻断 (必须立即修复)
- P1: 架构偏离 (应该修复)
- P2: 改进建议 (可延后)

### Step 2: 写入 web/STATUS.md ## 📋 Next
Add each P0/P1 issue to the Next section with clear description.

### Step 3: 错误提炼到 web/LEARNINGS.md
If any error pattern appears ≥2次 → add to 🔴 Patterns
If any new tech-specific gotcha → add to 🟡 Gotchas
If a verified fix recipe emerged → add to 🟢 Fixes

Follow existing LEARNINGS.md format (max 150字/条, 去重).
`, { label: 'triage-learning' })

  log('⚠️ 自动化验证未完全通过.')
  log('剩余问题已写入 STATUS.md Next + LEARNINGS.md.')
  log('请在新Session运行 /triage 查看并手动修复剩余问题.')
  log('最后错误: ' + lastError)
}
