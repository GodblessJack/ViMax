# ViMax Web 错误记忆

> 来源：39 轮 bugfix + 3 轮 UX enhancement + LoopEngineer 部署经验 + V3 架构升级 | 最后更新: 2026-06-23

---

## 🔴 Patterns (反模式 — 不要再犯)

| ID | 症状 | 根因 | 正确做法 | 来源 |
|----|------|------|----------|------|
| P1 | session 切换后旧 WS 事件残留 | sessionId 切换时未清理旧 WebSocket 实例 | 在 connect(newId) 前先 close() 旧连接，并在消息处理器中校验 currentSessionId | [[bugfix-round-13]] |
| P2 | render 启动失败无用户反馈 | pipeline_service 异常被静默吞掉，未推送 WS 事件 | 所有 agent tool 调用必须 try/catch 并推送 `step_error` WS 事件到前端 | [[bugfix-round-14]] |
| P3 | DeepSeek 配置分散在多处 | config.py, agent_service.py, .env 各有自己的 api_key 逻辑 | 统一到 BackendConfig（pydantic-settings），单一配置源，其余位置只读引用 | [[bugfix-round-9]] |
| P4 | workspace_root 路径硬编码 | 使用相对路径 `../.working_dir` 导致不同启动目录行为不同 | 使用 `Path(__file__).resolve().parent.parent.parent` 计算绝对根路径，所有工作目录基于此 | [[bugfix-round-11]] |
| P5 | 后端重启后 session 状态不一致 | 重启丢失内存中的 pipeline 状态但 sessions.json 仍标记为 running | 启动时扫描所有 running session，检查实际进程状态并做 orphan recovery | [[bugfix-round-12]] |
| P6 | API headers merge 顺序错误 | 合并字典时用户 headers 覆盖了系统 headers | 系统 headers 最后合并，确保不被用户输入覆盖 | [[bugfix-round-6]] |
| P7 | stale closure 在 agent 回调中 | agent 回调闭包引用了旧 session 变量 | 回调中始终通过 session_service.get(sid) 重新获取最新 session | [[bugfix-round-9]] |
| P8 | has_final_video 只检查 scene_0 | 视频可能分布在多个 scene 目录 | 扫描所有 scene_{index} 目录，找到任意有效视频即返回 | [[bugfix-round-6]] |
| P9 | delete_session 并发导致 KeyError | 多个请求同时操作 session 字典 | 使用 asyncio.Lock 保护 session 字典的增删操作 | [[bugfix-round-5]] |
| P10 | 硬编码端口 8000 | 部署环境端口可能冲突 | 通过 BackendConfig + VIMAX_WEB_PORT 环境变量配置 | [[bugfix-round-1]] |
| P11 | Zustand workspaceHtml no size cap — repeated append causes O(n^2) slowdown + memory leak | Cap at 5MB or limit fragment count | [[dynamic-html-artifacts-implementation]] |
| P12 | Workflow 用 regex 匹配 BLOCKED/APPROVED 硬阻塞 | 设计审查阶段 regex 匹配到的任何 BLOCKED 都直接 throw，不给 agent 判断严重度的机会 | 用 verdict agent 替换 regex: agent 自判断 P0 致命/HALT vs P1 可推进/PROCEED，记录风险后自动推进 | [[mianLoop初始化]] |
| P13 | asyncio.Lock 缺位导致 LLM conversation 并发竞态 | handle_message 和 handle_artifact_action 并发修改 _conversations 列表 | 每个 session 分配独立 asyncio.Lock，所有 conversation 变更都走 lock | [[dynamic-html-artifacts-implementation]] |
| P14 | REST API 与 Agent 步骤流竞态 | CreateDramaPage 调 REST /pipeline/start-workflow 直接启动 pipeline，与 Agent _run_workflow_steps 预确认门形成双路径竞态 | 前端统一通过 WS user:action 触发 Agent，不再直接调 REST | [[docs/v3-loop-engineer-plan]] |
| P15 | write_branches 白名单缺失导致分支自动切换 | loop.config.yaml write_branches 不含 feature-v3-upgrade，circuit-breaker hook 自动切回 long-chain | 每次创建新分支时更新 loop.config.yaml write_branches 白名单 | [[docs/v3-loop-engineer-plan]] |
| P16 | ConfirmationGate pre/post 共用 phase key | _run_workflow_steps 中 wait_for_confirmation 未传 phase 参数，pre/post 都默认 phase="after"，导致 gate key 冲突 | 预确认传 phase="before"，后确认传 phase="after" | [[docs/v3-loop-engineer-plan]] |
| P17 | run_step() 替代 start_planning() 破坏 MOCK_MODE | 独立步骤方法 (run_story_generation 等) 无 MOCK_MODE guard，而 start_planning() 有 | 每个独立步骤方法添加 MOCK_MODE guard + mock 生成逻辑 | [[docs/v3-loop-engineer-plan]] |
| P14 | Zustand useCallback 闭包捕获 stale state | handleIframeLoad/handleRefresh 引用旧的 workspaceHtml 而非最新值 | 用 `useWorkflowStore.getState()` 在回调内读取最新 state，而非依赖闭包变量 | [[dynamic-html-artifacts-implementation]] |
| P15 | Loop Engineer 审查引擎无限收敛 | 对抗性审查每轮都发现更深层理论问题，BLOCKER 数不降反升 | 设定收敛准则: (a) 静态全绿 (b) 功能性 BLOCKER=0 (c) 剩余为理论/防御层 → 记录接受风险后标记 DONE | [[dynamic-html-artifacts-implementation]] |

## 🟡 Gotchas (陷阱 — 踩过才知道)

| ID | 触发条件 | 症状 | 绕过方法 |
|----|----------|------|----------|
| G1 | 前端 pre-open 阶段关闭 WS | reconnect 时产生大量噪声日志 | 检查 `readyState !== OPEN` 时跳过 close，用 `onclose` 而非主动 close |
| G2 | polling 超时未设 guard | 无限轮询耗尽连接池 | 设置 max_polls 上限 + 超时自动降级到 REST |
| G3 | Zustand selector 返回新对象 | 组件不必要重渲染 | 使用浅比较 selector，或拆分 store slice 独立订阅 |
| G4 | Chat SessionIndex 路径与 pipeline session 不同 | 对话历史写入错误目录 | 始终从 config.working_dir_root 计算 SessionIndex 路径 |
| G5 | step 5-6 分镜/渲染的 mock 模式 | CI/测试中无真实 GPU 导致卡死 | 检测 MOCK_MODE 或 GPU 不可用时自动降级到 mock rendering |
| G6 | WebSocket 断连后 useSessionWebSocket 不通知 UI | 用户以为仍在连接中 | 断连后立即设置 `wsConnected: false` + `wsConnectionState: 'disconnected'` |
| G7 | confirmation gate 在 session 恢复后失效 | asyncio.Event 未从存储恢复 | session 恢复时重新创建 ConfirmationGate 实例 |
| G8 | DeepSeek tool calling 返回非标准 JSON | agent 解析 tool_use 参数失败 | 对所有 LLM 返回的 JSON 做 try/catch，fallback 到手动解析 |
| G9 | DeepSeek 长上下文中间信息丢失 | 超 128K tokens 后模型对中间内容的关注度下降 | 关键信息放在 context 的前 25% 或后 25% 位置 |
| G10 | DeepSeek Rate Limit 429 | 同时发起 >6 个 agent 调用 | 限制并行 subagent 数 ≤ 6，使用 semaphore 控制并发 |
| G11 | jq 中 string + object 类型错误 | bash hook 中用 `.tool_name + .tool_input` 拼接字符串和对象 | 使用 `{t: .tool_name, i: .tool_input}` 对象包装 |
| G12 | Sandboxed iframe postMessage origin is 'null' w/o allow-same-origin | Include 'null' in allowOrigins or add allow-same-origin flag | [[dynamic-html-artifacts-implementation]] |
| G13 | srcdoc HTML interpolation of agent messages bypasses escapeHtml helper | Always escape user content in srcdoc strings | [[dynamic-html-artifacts-implementation]] |
| G14 | postMessage bridge uses static PARENT_ORIGIN with no session secret | Same-origin XSS in iframe bypasses origin+source checks | [[dynamic-html-artifacts-implementation]] |
| G15 | handle_artifact_action 'modify' is no-op when gate not waiting | Stale-HTML user clicks silently drop; add fallback like 'form_submit' | [[dynamic-html-artifacts-implementation]] |
| G16 | Regex _sanitize_html misses encoded attrs, bare onfocus, SVG vectors, javascript:/data: URLs | Regex is insufficient for HTML sanitization | [[dynamic-html-artifacts-implementation]] |
| G17 | doc.write() after doc.close() implicitly calls doc.open() wiping all content | Check doc.closed before streaming append writes | [[dynamic-html-artifacts-implementation]] |
| G18 | pendingHtml set while iframe loads is overwritten by handleIframeLoad; readyRef not set in streaming path | Unify ready flag + defer writes until iframe is ready | [[dynamic-html-artifacts-implementation]] |
| G19 | html.unescape() BEFORE regex strip → 实体解码可能重建已剥离的标签 (双重编码绕过) | 使用 decode→strip 迭代循环 (3-pass) 收敛 | [[dynamic-html-artifacts-implementation]] |
| G20 | _send_step_html_to_workspace 构建的 HTML 不经 _sanitize_html 直接广播 | 文件内容 (story.txt) 中的用户文本未经 sanitize 嵌入 HTML | [[dynamic-html-artifacts-implementation]] |
| G21 | pipeline:error (冒号) vs pipeline_error (下划线) — 前端 handler 只匹配下划线版 | 统一使用 pipeline_error (下划线)，与 types.ts 的 WsServerEvent 定义一致 | [[dynamic-html-artifacts-implementation]] |
| G22 | iframe onError prop 不被 HTML/React 支持 (仅 img/script/link 可用) | 用 timeout + artifact:ready 超时检测替代 onError | [[dynamic-html-artifacts-implementation]] |
| G23 | ConfirmationGate._pending_phases 只存最新 phase | 预确认 (before) 和后确认 (after) 快速交替时，_pending_phases 被覆盖导致 resume() 路由到错误 gate | resume() 始终传显式 phase 参数，不依赖 _pending_phases 自动检测 | [[docs/v3-loop-engineer-plan]] |
| G24 | ChatOpenAI 构造时验证 SOCKS 代理 URL | LangChain init_chat_model 在 MOCK_MODE 下仍构造 ChatOpenAI，proxy 验证失败导致 step error | MOCK_MODE guard 放在 _build_chat_model() 调用之前 | [[docs/v3-loop-engineer-plan]] |

## 🟢 Fixes (已验证的修复配方)

| ID | 诊断 | 修复步骤 | 验证方式 |
|----|------|----------|----------|
| F1 | has_final_video scene_0 fallback | 检查所有 scene_{i} 目录找视频文件 → 加 /final_video 专用端点 | `curl /api/works/{sid}/final_video` 返回可用 URL |
| F2 | StepIndicator 无法点击导航 | 给 StepIndicator 按钮添加 onClick handler → 调用 workflowStore.navigateToStep() | 点击已完成的步骤卡片能跳转 |
| F3 | 错误信息不区分用户/系统错误 | 在 pipeline_service 中分类异常 → `user_error` 推送可操作提示，`system_error` 推送通用信息 | 前端 Toast 区分展示 |
| F4 | orphaned sessions 启动时卡死 | 在 lifespan startup 中扫描 sessions → running 状态且无活跃进程 → 标记为 error | 重启后服务正常，无卡死 session |
| F5 | step 5 confirmation 无 artifact 数据 | agent_tool run_step 完成后 push `step_completed` 事件携带 artifact_paths | 前端 workarea 自动加载产物内容 |
| F6 | HTML sanitizer 被实体编码绕过 (&#x3d; 等) | 3-pass decode→strip 迭代循环 + style URL 剥离 (url(javascript:)) | `_sanitize_html` 单元测试 7/7 通过 |
| F7 | postMessage targetOrigin '*' 任意来源注入 | BRIDGE_SCRIPT 注入 PARENT_ORIGIN + SESSION_NONCE + e.source 校验 + 'null' origin 接受 | 浏览器验证 sandbox=correct |
| F8 | _send_step_html_to_workspace 绕过 sanitizer | 在 broadcast 前加 `from agent_tools import _sanitize_html; html = _sanitize_html(html)` | agent_tools 覆盖全链路 |

## 📊 统计

| 类别 | 数量 |
|------|------|
| 反模式 (Patterns) | 15 |
| 陷阱 (Gotchas) | 22 |
| 修复配方 (Fixes) | 8 |
| 累计 bugfix 轮次 | 39 |
| DynamicWorkspace 实现轮次 | 5 (Loop Engineer 验证) |
