"""Agent service -- manages Agent lifecycle with Anthropic SDK.

AgentService integrates with PipelineService by calling pipeline methods
as tools, not replacing them.  The Agent system prompt (in Chinese) instructs
it to wait for user confirmation after each step.

Dependencies:
    - anthropic (Anthropic Python SDK) -- pip install anthropic
    - PipelineService (lazy-initialized)
    - ConfirmationGate (asyncio.Event-based pause/resume)
    - agent_tools (plain async functions registered as tools)
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from web.backend.services.confirmation_gate import ConfirmationGate
from web.backend.services.agent_tools import (
    AVAILABLE_TOOLS,
    build_tool_schemas,
)

logger = logging.getLogger(__name__)

# ── System prompt (Chinese) ──────────────────────────────────────────────

AGENT_SYSTEM_PROMPT = """你是 ViMax 的创作助手。你的职责是帮助用户完成短剧创作的全流程。

## ⚠️ 核心铁律：你必须使用工具来执行操作！

你是一个工具驱动的 Agent。当用户要求进行任何创作流程操作时，你必须调用相应的工具，而不是只用文字回复。
以下行为是严格禁止的：
- ❌ 用文字说"我已经生成了故事大纲" — 必须调用 run_step 或 request_step_execution 来真正执行
- ❌ 用文字说"确认开始规划吗？" — 必须调用 ask_user 工具来发起确认
- ❌ 用文字模拟 Pipeline 行为 — 必须调用实际工具来驱动 Pipeline

正确做法：
- ✅ 用户说"开始创作" → 调用 inspect_pipeline 检查进度，然后用 run_step 逐步执行
- ✅ 需要用户确认 → 调用 ask_user 或 request_confirmation
- ✅ 查看生成结果 → 调用 read_artifact 或 review_artifact

## 用户意图解析（最高优先级 — 在调用任何工具之前先解析）

用户的原始输入中通常包含多个维度的创作意图。你必须在处理前解析：
- **plot** (情节): 简短的故事梗概，如 "小猫打败老虎"
- **genre** (类型): comedy / wuxia / suspense / scifi / romance / horror / fantasy / slice_of_life / action / documentary
- **style** (风格): 写实 / 动画 / 水墨 / 赛博朋克 / 绘本 / 皮克斯 / 宫崎骏 / 默片 / 胶片 / 油画
- **duration** (时长): 15秒 / 30秒 / 60秒 / 90秒 (默认为 60秒)

⚠️ 关键规则: 输入如 "15秒小猫打败老虎" 是**情节描述 (PLOT DESCRIPTION)**，不是角色名字！
  - "小猫" = 角色身份/物种 (cat)，不是角色名字 "小猫"
  - "打败" = 情节动作 (fight/defeat)
  - "老虎" = 对手身份/物种 (tiger)，不是角色名字 "老虎"
  - "15秒" = duration 约束
  - 解析结果: {plot: "一只小猫击败了一只老虎", genre: "comedy", duration: "15秒"}

解析优先级: 时间长度 > 动作/行为词 > 身份/物种词 > 人名猜测
如果描述中只有身份/物种词 (猫/兔/龙/机器人/老师/士兵)，禁止将其当作角色姓名。
角色姓名由后续 story_generation 步骤的 LLM 自动生成。

## 风格/参数映射表

创作风格将直接影响视频生成的视觉参数。在 run_step 时，根据识别到的 genre/style 选择对应参数:

| genre (类型) | style (视觉风格) | 画面色调 | 镜头偏好 | 节奏 | 适用场景 |
|-------------|-----------------|---------|---------|------|---------|
| comedy | 动画/皮克斯 | 暖色高饱和 | 中近景为主 | 快节奏 | 搞笑短片 |
| wuxia | 水墨/写实 | 冷色低饱和 | 广角大全景 | 中速 | 武侠打斗 |
| suspense | 写实/胶片 | 暗调高对比 | 特写+手持 | 慢→快 | 悬疑推理 |
| scifi | 赛博朋克 | 霓虹冷调 | 广角对称 | 中速 | 科幻未来 |
| romance | 绘本/宫崎骏 | 暖柔粉调 | 浅景深近景 | 慢节奏 | 爱情故事 |
| horror | 写实/暗调 | 极端暗调 | 窥视视角 | 慢→突发 | 恐怖惊悚 |
| fantasy | 油画/动画 | 高饱和魔幻 | 鸟瞰+仰拍 | 中速 | 奇幻冒险 |
| slice_of_life | 写实/绘本 | 自然中性 | 平视中景 | 舒缓 | 日常故事 |
| action | 写实/动画 | 高对比冷调 | 快速摇镜 | 极快 | 动作战斗 |
| documentary | 写实/胶片 | 自然光 | 手持跟拍 | 自然 | 纪实风格 |

这些参数作为 run_step 调用时的 params.style 和 params.user_requirement 传递。

## Pipeline 上下文感知

在每个步骤前，检查当前 pipeline 进度:
- 使用 get_session_state 获取已完成的步骤、可用产物
- 使用 inspect_pipeline 获取细粒度的子步骤进度
- 使用 read_artifact 读取产物内容以理解上下文

## 工作流程

1. 首先解析用户输入，提取 genre/plot/style/duration 四元组
2. 如果信息不足，使用 ask_user 询问缺失的关键维度
3. 利用工具逐步完成: 故事开发 → 角色抽取 → 剧本创作 → 分镜规划 → 角色肖像生成 → 场景渲染
4. 每个步骤执行前先做预确认 (broadcast step:need_confirm_before)，等待用户确认后再执行
5. 每个步骤完成后，必须等待用户确认才能进入下一步
6. 主动给用户建议，但不替用户做决定

## 重要规则

- 使用 get_session_state 了解当前会话状态
- 使用 read_artifact 读取已生成的产物
- 使用 inspect_pipeline 内省 pipeline 详细进度
- 使用 run_step 执行每个流水线步骤（V3 预确认门会在执行前弹出，等待用户确认）
- 不要使用 create_story（那是旧版批量执行工具，会绕过步骤确认门）
- 使用 request_confirmation 在每个步骤完成后请求用户确认 (phase='after')
- 使用 ask_user 向用户提问以获取更多信息
- 使用 update_artifact 根据用户反馈修改产物内容
- 如果用户想重来，使用 restart_workflow
- 始终用中文与用户交流，保持简洁友好
- 不要替用户做创作决定，只给建议
- 执行步骤前必须广播预确认通知，等待用户确认后才能开始执行"""

# ── Step metadata for pre-step confirmation broadcasts ──────────────────

_STEP_META_DEFAULT = {
    "label": "未知步骤",
    "estimated_duration": "约 30 秒",
    "side_effects": ["会在会话工作区创建产物文件"],
}

_STEP_META: dict[str, dict] = {
    "story_generation": {
        "label": "故事构思",
        "estimated_duration": "约 30 秒",
        "side_effects": [
            "会在会话工作区创建 idea2video/story.txt",
            "会调用 LLM 生成故事文本",
        ],
    },
    "character_extraction": {
        "label": "角色提取",
        "estimated_duration": "约 20 秒",
        "side_effects": [
            "读取 idea2video/story.txt 中的故事文本",
            "会调用 LLM 提取角色信息",
            "会在会话工作区创建 idea2video/characters.json",
        ],
    },
    "script_writing": {
        "label": "剧本编写",
        "estimated_duration": "约 30 秒",
        "side_effects": [
            "读取 story.txt 和 characters.json",
            "会调用 LLM 编写分场景剧本",
            "会在会话工作区创建 idea2video/script.json",
        ],
    },
    "storyboard_design": {
        "label": "分镜设计",
        "estimated_duration": "约 60 秒 (多场景)",
        "side_effects": [
            "读取 script.json 中的场景列表",
            "会调用 LLM 为每个场景设计分镜",
            "会在会话工作区创建 idea2video/scene_N/storyboard.json",
        ],
    },
    "character_portraits": {
        "label": "角色肖像生成",
        "estimated_duration": "约 2 分钟 (多角色)",
        "side_effects": [
            "读取 characters.json 中的角色信息",
            "会调用图像生成模型为每个角色生成肖像",
            "会在会话工作区创建 idea2video/character_portraits/",
        ],
    },
    "video_rendering": {
        "label": "视频渲染",
        "estimated_duration": "约 5 分钟 (多场景)",
        "side_effects": [
            "读取 storyboard.json 和角色肖像",
            "会调用视频渲染引擎合成每个场景",
            "会在会话工作区创建 idea2video/scene_N/output.mp4",
            "这是最耗时的步骤，请确认参数无误",
        ],
    },
}


class AgentService:
    """Manages Agent lifecycle, registers Pipeline Tools, handles user messages.

    Each session has at most one active Agent conversation thread.
    """

    def __init__(
        self,
        pipeline_service: Any | None = None,
    ) -> None:
        self._pipeline_service = pipeline_service
        self._confirmation_gate = ConfirmationGate()
        # ── V3: Wire up broadcast callback so ConfirmationGate can send WS events ──
        self._confirmation_gate.set_broadcast_callback(self.broadcast)
        self._client: anthropic.AsyncAnthropic | None = None
        self._conversations: dict[str, list[dict[str, Any]]] = {}
        self._agent_tasks: dict[str, Any] = {}
        # Callbacks dict: session_id -> set of async callables for WS broadcasts
        self._ws_callbacks: dict[str, set] = {}

    # ── Anthropic client lazy-init ──────────────────────────────────────

    def _get_client(self) -> Any:
        """Lazy-initialize the Anthropic client from ViMax LLM config."""
        if self._client is not None:
            return self._client

        try:
            import anthropic
        except ImportError:
            logger.warning("anthropic package not installed — Agent chat unavailable")
            return None

        # V3: Use ANTHROPIC_* env vars (DeepSeek relay) — the canonical config for this project
        # Falls back to VIMAX_LLM_* / agent_runtime config / DashScope
        api_key = os.environ.get("ANTHROPIC_AUTH_TOKEN", "") or os.environ.get("ANTHROPIC_API_KEY", "")
        base_url = os.environ.get("ANTHROPIC_BASE_URL", "")

        if not api_key or not base_url:
            from web.backend.config import backend_config
            from agent_runtime.config import llm_api_key, llm_base_url
            root = str(backend_config.vi_max_root)
            api_key = api_key or llm_api_key(root)
            base_url = base_url or llm_base_url(root)

        # DashScope fallback
        ds_key = os.environ.get("DASHSCOPE_API_KEY", "")
        if ds_key and not api_key:
            api_key = ds_key
            base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"

        # Clear proxy vars — httpx doesn't support SOCKS proxies
        _saved_proxy = {}
        for _k in list(os.environ):
            if 'proxy' in _k.lower():
                _saved_proxy[_k] = os.environ.pop(_k)
        try:
            self._client = anthropic.AsyncAnthropic(
                api_key=api_key,
                base_url=base_url,
            )
        finally:
            os.environ.update(_saved_proxy)
        return self._client

    # ── WS broadcast ────────────────────────────────────────────────────

    def register_ws_callback(self, session_id: str, callback: Any) -> None:
        """Register a WS send callback for a session.

        The callback is an async callable that accepts a dict payload.
        """
        self._ws_callbacks.setdefault(session_id, set()).add(callback)

    def unregister_ws_callback(self, session_id: str, callback: Any) -> None:
        callbacks = self._ws_callbacks.get(session_id, set())
        callbacks.discard(callback)

    async def broadcast(self, session_id: str, payload: dict[str, Any]) -> None:
        """Send a payload to all WS callbacks registered for this session."""
        callbacks = list(self._ws_callbacks.get(session_id, set()))
        for cb in callbacks:
            try:
                await cb(payload)
            except Exception:
                logger.debug("WS callback failed for session %s", session_id, exc_info=True)

    # ── User message handling ────────────────────────────────────────────

    async def handle_message(
        self,
        session_id: str,
        message: str,
    ) -> dict[str, Any]:
        """Handle a user:text message -- non-blocking conversational reply.

        The Agent processes the message and returns a text response.
        """
        # ── Proxy guard: httpx reads proxy vars at request time ────
        _saved = {}
        for _k in list(os.environ):
            if 'proxy' in _k.lower():
                _saved[_k] = os.environ.pop(_k)
        try:
            # ── V3: Pre-process — auto-start pipeline for creation intents ──
            create_keywords = ["开始创作", "开始规划", "开始生成", "我想创作", "请开始规划",
                              "帮我创作", "创建一个", "生成一个", "拍一个"]
            if any(kw in message for kw in create_keywords):
                try:
                    from web.backend.main import get_session_service
                    svc = get_session_service()
                    session = svc.get_session(session_id)

                    # Guard: only auto-start from 'created' stage to prevent
                    # dual-path race with user:action/start_workflow (ws.py)
                    if session is not None and session.stage != "created":
                        logger.info(
                            "Skipping auto-start for session %s — stage=%s (workflow already active)",
                            session_id, session.stage,
                        )
                        # Fall through to LLM chat — Agent will respond conversationally
                    else:
                        logger.info("Auto-starting V3 gated workflow for session %s", session_id)
                        # Parse idea/style from message
                        idea = message
                        style = "wuxia"
                        # Extract the core idea
                        for prefix in ["我想创作一个短剧：", "我想创作：", "拍一个", "创作一个"]:
                            if prefix in message:
                                idea = message.split(prefix, 1)[1].split("。")[0].strip()
                                break
                        # Detect style from message
                        for kw, s in [("武侠", "wuxia"), ("古风", "ancient"), ("现代", "modern"),
                                      ("悬疑", "suspense"), ("喜剧", "comedy")]:
                            if kw in message:
                                style = s
                                break
                        # Ensure session exists
                        if session is None:
                            svc.create_session(idea=idea, style=style, user_requirement="")
                        # Use V3 gated workflow (pre_confirm → execute → post_confirm)
                        await self.start_workflow(
                            session_id=session_id,
                            idea=idea,
                            style=style,
                            user_requirement="",
                        )
                        return {"reply": (
                            "🚀 规划已启动！正在分析你的创意并生成故事内容...\n\n"
                            "你可以在左侧工作区实时查看进度：\n"
                            "1️⃣ 故事构思 → 2️⃣ 角色提取 → 3️⃣ 剧本编写 → 4️⃣ 分镜设计\n\n"
                            "生成过程中如有任何想法，随时告诉我。"
                        )}
                except Exception as e:
                    logger.exception("Auto-start V3 workflow failed for %s", session_id)
                    # Fall through to LLM chat if pipeline start fails

            client = self._get_client()
            if client is None:
                return {"reply": "Agent chat requires the anthropic Python package."}
            conversation = self._get_or_create_conversation(session_id)

            conversation.append({"role": "user", "content": message})

            response = await client.messages.create(
                model=os.environ.get("ANTHROPIC_MODEL", "deepseek-v4-pro[1m]"),
                max_tokens=4096,
                system=AGENT_SYSTEM_PROMPT,
                messages=conversation,
                tools=build_tool_schemas(),
                tool_choice={"type": "any"},  # Force tool use — DeepSeek won't choose tools with "auto"
            )

            # Build assistant message with ALL content blocks (text + tool_use)
            assistant_blocks: list[dict[str, Any]] = []
            tool_results: list[dict[str, Any]] = []
            assistant_text = ""

            for block in response.content:
                if block.type == "text":
                    assistant_text += block.text
                    assistant_blocks.append({"type": "text", "text": block.text})
                elif block.type == "tool_use":
                    assistant_blocks.append({
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    })
                    # Execute tool
                    tool_result = await self._execute_tool(
                        session_id,
                        block.name,
                        block.input,
                    )
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(tool_result, ensure_ascii=False),
                    })

            # Append assistant message with all blocks (required format for DeepSeek)
            conversation.append({
                "role": "assistant",
                "content": assistant_blocks,
            })

            # Append tool results as a single user message (if any)
            if tool_results:
                conversation.append({
                    "role": "user",
                    "content": tool_results,
                })

            return {"reply": assistant_text}
        except Exception as exc:
            logger.exception("Agent handle_message failed for session %s", session_id)
            return {"reply": f"抱歉，处理消息时出错: {exc}"}
        finally:
            os.environ.update(_saved)

    async def handle_confirm(
        self,
        session_id: str,
        payload: dict[str, Any] | None = None,
    ) -> None:
        """Handle a user:confirm event -- unblock the confirmation gate."""
        self._confirmation_gate.resume(session_id, {
            "action": "confirm",
            "payload": payload or {},
            "reply": "",
        })

    async def handle_confirm_before(
        self,
        session_id: str,
        step: str = "",
        payload: dict[str, Any] | None = None,
        reply: str = "",
    ) -> None:
        """Handle a user:confirm_before event -- user approves pre-execution step.

        Resumes the confirmation gate so the Agent proceeds to execute the step.
        """
        logger.info(
            "handle_confirm_before: session=%s step=%s reply=%.80s",
            session_id, step, reply or "(empty)",
        )
        self._confirmation_gate.resume(session_id, {
            "action": "confirm_before",
            "step": step,
            "payload": payload or {},
            "reply": reply,
        })

    async def handle_reject_before(
        self,
        session_id: str,
        step: str = "",
        payload: dict[str, Any] | None = None,
        reply: str = "",
    ) -> None:
        """Handle a user:reject_before event -- user rejects pre-execution step.

        Includes optional modified parameters for the Agent to adjust before re-execution.
        """
        logger.info(
            "handle_reject_before: session=%s step=%s reply=%.80s",
            session_id, step, reply or "(empty)",
        )
        self._confirmation_gate.resume(session_id, {
            "action": "reject_before",
            "step": step,
            "payload": payload or {},
            "reply": reply,
        })

    async def handle_modify(
        self,
        session_id: str,
        payload: dict[str, Any] | None = None,
        reply: str = "",
    ) -> None:
        """Handle a user:modify event -- deliver modification request to Agent."""
        self._confirmation_gate.resume(session_id, {
            "action": "modify",
            "payload": payload or {},
            "reply": reply,
        })

    async def handle_suggestion_reply(
        self,
        session_id: str,
        reply_text: str,
    ) -> None:
        """Handle a suggestion chip click -- resumes the confirmation gate with the text.

        When a user clicks a suggestion chip in the chat panel, the text is sent via
        user:message. If the Agent is waiting on an ask_user confirmation gate, this
        resumes it with the suggestion text as the reply.
        """
        self._confirmation_gate.resume(session_id, {
            "action": "confirm",
            "payload": {},
            "reply": reply_text,
        })

    async def handle_regenerate(
        self,
        session_id: str,
        step: str,
        feedback: str | None = None,
    ) -> None:
        """Handle a user request to regenerate a step.

        Resets the step runtime state and re-executes it via tool_run_step.
        Broadcasts agent:regenerate_ack and step:preparing before execution,
        then step:completed or step:error on result.
        """
        from web.backend.services.agent_tools import tool_run_step

        # Acknowledge the regenerate request
        await self.broadcast(session_id, {
            "type": "agent:regenerate_ack",
            "session_id": session_id,
            "step": step,
        })

        # Signal that the step is being prepared for regeneration
        await self.broadcast(session_id, {
            "type": "step:preparing",
            "step": step,
            "context": {
                "inputs": {"feedback": feedback or ""},
                "constraints": [],
                "agentIntent": f"Regenerating {step} based on user feedback",
            },
        })

        try:
            result = await tool_run_step(
                session_id=session_id,
                step_name=step,
                params={"feedback": feedback or ""},
                agent_service=self,
            )

            if result.get("status") == "error":
                await self.broadcast(session_id, {
                    "type": "step:error",
                    "step": step,
                    "error": result.get("error", "Regeneration failed"),
                    "recoverable": True,
                })
        except Exception as exc:
            logger.exception(
                "handle_regenerate failed for session %s step %s",
                session_id, step,
            )
            await self.broadcast(session_id, {
                "type": "step:error",
                "step": step,
                "error": str(exc),
                "recoverable": True,
            })

    # ── Conversation management ─────────────────────────────────────────

    def _get_or_create_conversation(self, session_id: str) -> list[dict[str, Any]]:
        if session_id not in self._conversations:
            self._conversations[session_id] = []
        return self._conversations[session_id]

    # ── User intent parsing ─────────────────────────────────────────────

    def parse_user_intent(self, raw_input: str) -> dict[str, str]:
        """Parse raw user input into structured intent: {genre, plot, style, duration}.

        Rules (in priority order):
          1. Detect duration pattern: N秒 / Ns / Nmin / N分钟
          2. Detect action/behavior words → these indicate PLOT, not names
          3. Detect identity/species words (猫/兔/龙/机器人/老师/士兵...) → roles, not names
          4. Detect genre keywords → map to genre
          5. Detect style keywords → map to visual style
          6. Remaining text → plot description

        ⚠️  "15秒小猫打败老虎" → {plot: "一只小猫击败了一只老虎", genre: "comedy",
                                    duration: "15秒"} — NOT character names!
        """
        import re

        result: dict[str, str] = {
            "genre": "",
            "plot": "",
            "style": "",
            "duration": "60",  # seconds, default
        }

        s = raw_input.strip()
        if not s:
            result["plot"] = raw_input
            return result

        # ── Step 1: Extract duration ──────────────────────────────────
        dur_patterns = [
            (r"(\d+)\s*秒", "seconds"),
            (r"(\d+)\s*s\b", "seconds"),
            (r"(\d+)\s*分钟?", "minutes"),
            (r"(\d+)\s*min\b", "minutes"),
        ]
        for pat, unit in dur_patterns:
            m = re.search(pat, s, re.IGNORECASE)
            if m:
                val = int(m.group(1))
                if unit == "minutes":
                    val *= 60
                result["duration"] = str(val)
                s = s[: m.start()] + s[m.end() :]
                s = s.strip()
                break

        # ── Step 2: Detect genre keywords ─────────────────────────────
        genre_map = {
            "喜剧": "comedy", "搞笑": "comedy", "幽默": "comedy",
            "武侠": "wuxia", "江湖": "wuxia",
            "悬疑": "suspense", "推理": "suspense", "侦探": "suspense",
            "科幻": "scifi", "未来": "scifi", "机器人": "scifi", "AI": "scifi",
            "爱情": "romance", "恋爱": "romance", "言情": "romance",
            "恐怖": "horror", "惊悚": "horror", "鬼": "horror",
            "奇幻": "fantasy", "魔法": "fantasy", "仙侠": "fantasy",
            "日常": "slice_of_life", "生活": "slice_of_life", "校园": "slice_of_life",
            "动作": "action", "战斗": "action", "格斗": "action",
            "纪实": "documentary", "记录": "documentary",
        }
        for keyword, genre_val in genre_map.items():
            if keyword in s:
                result["genre"] = genre_val
                s = s.replace(keyword, " ").strip()
                break

        # ── Step 3: Detect style keywords ─────────────────────────────
        style_map = {
            "水墨": "ink_wash", "国画": "ink_wash",
            "写实": "realistic",
            "动画": "animation", "卡通": "animation",
            "赛博": "cyberpunk", "朋克": "cyberpunk",
            "绘本": "picture_book",
            "皮克斯": "pixar",
            "宫崎骏": "ghibli",
            "默片": "silent_film",
            "胶片": "film",
            "油画": "oil_painting",
        }
        for keyword, style_val in style_map.items():
            if keyword in s:
                result["style"] = style_val
                s = s.replace(keyword, " ").strip()
                break

        # ── Step 4: Identify action/behavior words → PLOT markers ─────
        action_words = [
            "打败", "战胜", "击败", "战斗", "打架",
            "逃跑", "追逐", "追赶",
            "寻找", "发现", "探索",
            "拯救", "保护", "守卫",
            "爱上", "喜欢", "暗恋",
            "变身", "穿越", "转生",
            "搞笑", "整蛊", "恶搞",
            "做饭", "烹饪", "开店",
            "上学", "考试", "毕业",
            "冒险", "旅行", "探险",
            "比赛", "对决", "竞争",
            "冒充", "伪装", "隐藏",
            "成长为", "变成", "成为",
            "复仇", "报复",
        ]
        found_action = any(w in s for w in action_words)

        # ── Step 5: Detect identity/species words → roles, NOT names ──
        role_species = [
            "小猫", "小狗", "兔子", "龙", "凤凰",
            "猫", "狗", "鸟", "鱼", "狐狸", "狼", "熊", "虎", "蛇", "鹰",
            "老师", "学生", "医生", "警察", "士兵", "厨师", "司机",
            "男孩", "女孩", "少年", "少女", "老人", "小孩", "婴儿",
            "机器人", "AI", "外星人", "幽灵", "吸血鬼", "僵尸",
            "公主", "王子", "国王", "女王", "骑士", "巫师", "精灵",
            "忍者", "武士", "剑客",
        ]
        # Only flag as plot if there's also an action word present
        has_role = any(w in s for w in role_species)

        # ── Step 6: Remaining text → plot description ─────────────────
        if found_action or has_role:
            # This is clearly a plot description, not a character name
            remaining = s.strip()
            if remaining:
                result["plot"] = remaining
            else:
                result["plot"] = s
        else:
            # Could be a name or abstract idea
            result["plot"] = s.strip()

        # ── Fallback genre ────────────────────────────────────────────
        if not result["genre"]:
            # Infer from content
            if found_action and ("搞笑" in raw_input or "喜剧" in raw_input
                                 or "好笑" in raw_input or "逗" in raw_input):
                result["genre"] = "comedy"
            elif found_action:
                result["genre"] = "action"
            else:
                result["genre"] = "slice_of_life"

        return result

    # ── Tool execution ──────────────────────────────────────────────────

    async def _execute_tool(
        self,
        session_id: str,
        tool_name: str,
        tool_input: dict[str, Any],
    ) -> Any:
        """Execute a registered tool by name and return its result."""
        tool_fn = AVAILABLE_TOOLS.get(tool_name)
        if tool_fn is None:
            return {"error": f"Unknown tool: {tool_name}"}

        try:
            result = await tool_fn(
                session_id=session_id,
                agent_service=self,
                **{k: v for k, v in tool_input.items() if k != "session_id"},
            )
            return result
        except Exception as exc:
            logger.exception("Tool %s failed for session %s", tool_name, session_id)
            return {"error": str(exc)}

    async def handle_navigate(
        self,
        session_id: str,
        step_index: int,
    ) -> None:
        """Handle a user:navigate event."""
        await self.broadcast(session_id, {
            "type": "agent:navigate",
            "session_id": session_id,
            "step_index": step_index,
        })

    async def handle_action(
        self,
        session_id: str,
        action: str,
        payload: dict[str, Any] | None = None,
    ) -> None:
        """Handle a user:action event (generic UI-triggered action)."""
        if action == "restart":
            self._conversations.pop(session_id, None)
            await self._confirmation_gate.cancel(session_id)
            from web.backend.main import get_session_service
            try:
                svc = get_session_service()
                svc._index.update_stage(session_id, "created", "User restarted workflow")
            except Exception:
                pass
        elif action == "cancel":
            await self._confirmation_gate.cancel(session_id)
            self._conversations.pop(session_id, None)

    # ── Cleanup ─────────────────────────────────────────────────────────

    @property
    def confirmation_gate(self) -> ConfirmationGate:
        return self._confirmation_gate

    def cleanup_session(self, session_id: str) -> None:
        """Release all resources for a session."""
        self._conversations.pop(session_id, None)
        self._confirmation_gate.cancel_sync(session_id)
        self._ws_callbacks.pop(session_id, None)
        self._agent_tasks.pop(session_id, None)

    # ── Step-by-step workflow orchestrator ─────────────────────────────

    async def start_workflow(
        self,
        session_id: str,
        idea: str,
        style: str = "wuxia",
        user_requirement: str = "",
    ) -> None:
        """Run the full pipeline step by step, pausing for confirmation after each.

        Each step: prepare → execute → show result → request confirmation → wait.
        The frontend drives progression via user:confirm / user:modify WS events.
        """
        import asyncio

        task = asyncio.create_task(
            self._run_workflow_steps(session_id, idea, style, user_requirement)
        )
        self._agent_tasks[session_id] = task

    async def _run_workflow_steps(
        self,
        session_id: str,
        idea: str,
        style: str,
        user_requirement: str,
    ) -> None:
        """Internal: execute pipeline steps one at a time with confirmation gates.

        Iterates over all 6 workflow steps.  For each step:
          1. Calls tool_run_step (which delegates to PipelineService).
          2. On error, presents retry/skip/cancel to the user via confirmation gate.
          3. On success, waits for user confirmation before proceeding (unless last step).
        """
        import asyncio
        from web.backend.services.agent_tools import tool_run_step
        from web.backend.main import get_session_service

        WORKFLOW_STEP_NAMES = [
            "story_generation",
            "character_extraction",
            "script_writing",
            "storyboard_design",
            "character_portraits",
            "video_rendering",
        ]

        try:
            svc = get_session_service()

            # Ensure session exists
            detail = svc.get_session(session_id)
            if detail is None:
                await self.broadcast(session_id, {
                    "type": "step:error", "step": "init",
                    "error": "Session not found", "recoverable": False,
                })
                return

            await self.broadcast(session_id, {
                "type": "agent:workflow_started",
                "session_id": session_id,
                "message": "Starting step-by-step workflow",
            })
            logger.info("Workflow: starting step-by-step for session %s", session_id)

            i = 0
            while i < len(WORKFLOW_STEP_NAMES):
                step_name = WORKFLOW_STEP_NAMES[i]

                # Check session still active
                svc = get_session_service()
                session = svc.get_session(session_id)
                if session is None:
                    break
                stage = getattr(session, "stage", "")
                if stage == "cancelled":
                    logger.info("Workflow: session %s cancelled, stopping", session_id)
                    break

                # ── Pre-step confirmation ──────────────────────────────
                # Build step metadata for pre-step confirm broadcast
                step_meta = _STEP_META.get(step_name, _STEP_META_DEFAULT)
                step_deps = [s for s in WORKFLOW_STEP_NAMES[
                    :WORKFLOW_STEP_NAMES.index(step_name)
                ]]
                step_params: dict[str, Any] = {
                    "idea": idea, "style": style,
                    "user_requirement": user_requirement,
                }

                await self.broadcast(session_id, {
                    "type": "step:need_confirm_before",
                    "step": step_name,
                    "session_id": session_id,
                    "phase": "before",
                    "message": (
                        f"即将开始执行 [{step_meta['label']}]，"
                        f"预估耗时 {step_meta['estimated_duration']}。"
                        f"参数: idea={idea[:60]}, style={style}。是否继续？"
                    ),
                    "context": {
                        "stepName": step_name,
                        "params": step_params,
                        "estimatedDuration": step_meta["estimated_duration"],
                        "dependencies": step_deps,
                        "sideEffects": step_meta["side_effects"],
                    },
                    "source": "agent",
                })

                # Announce step preparing
                await self.broadcast(session_id, {
                    "type": "pipeline:status",
                    "session_id": session_id,
                    "stage": step_name,
                    "message": f"Starting {step_name}",
                })

                # Wait for user to confirm before executing
                logger.info(
                    "Workflow: PRE-STEP waiting confirmation for %s (session %s)",
                    step_name, session_id,
                )
                try:
                    pre_gate = await self._confirmation_gate.wait_for_confirmation(
                        session_id=session_id,
                        prompt=f"[{step_meta['label']}] 即将开始执行，是否继续？",
                        timeout=1800.0,
                        step_name=f"{step_name}:before",
                        phase="before",  # V3: distinguish from post-confirm gate
                    )
                    pre_action = pre_gate.get("action", "")
                    if pre_action == "reject_before":
                        pre_reply = pre_gate.get("reply", "")
                        pre_payload = pre_gate.get("payload", {})
                        logger.info(
                            "Workflow: user REJECTED before step %s, reply=%.100s",
                            step_name, pre_reply,
                        )
                        # Adjust params based on user feedback
                        if isinstance(pre_payload, dict):
                            new_idea = pre_payload.get("idea", "")
                            new_style = pre_payload.get("style", "")
                            if new_idea:
                                idea = new_idea
                            if new_style:
                                style = new_style
                            user_requirement = pre_payload.get(
                                "user_requirement", pre_reply or user_requirement,
                            )
                        elif pre_reply:
                            user_requirement = pre_reply
                        # Loop back to same step with adjusted params
                        continue
                    elif pre_action == "cancelled":
                        svc._index.update_stage(session_id, "cancelled", "用户取消")
                        return
                    # "confirm_before", "confirm", "", or timeout → proceed
                    logger.info(
                        "Workflow: pre-step confirmed for %s (action=%s), proceeding",
                        step_name, pre_action,
                    )
                except asyncio.TimeoutError:
                    logger.info(
                        "Workflow: pre-step timeout for %s, proceeding anyway",
                        step_name,
                    )
                except Exception:
                    logger.exception(
                        "Workflow: pre-step gate error for %s, proceeding",
                        step_name,
                    )

                # Execute the step via tool_run_step
                result = await tool_run_step(
                    session_id=session_id,
                    step_name=step_name,
                    params={"idea": idea, "style": style,
                            "user_requirement": user_requirement},
                    agent_service=self,
                )

                if result.get("status") == "error":
                    error_msg = result.get("error", "Unknown error")
                    logger.warning(
                        "Workflow: step %s failed for %s: %s",
                        step_name, session_id, error_msg,
                    )

                    # Present error to user and ask for retry/skip/cancel
                    await self.broadcast(session_id, {
                        "type": "step:need_confirm",
                        "step": step_name,
                        "message": f"步骤 {step_name} 执行失败: {error_msg}。要重试还是跳过？",
                        "suggestions": ["重试", "跳过", "取消"],
                    })

                    try:
                        gate_result = await self._confirmation_gate.wait_for_confirmation(
                            session_id=session_id,
                            prompt=f"步骤 {step_name} 执行失败: {error_msg}",
                            timeout=1800.0,
                            step_name=step_name,
                        )
                        action = gate_result.get("action", "")
                        if action == "cancelled":
                            svc._index.update_stage(session_id, "cancelled", "用户取消")
                            return
                        elif action in ("modify", "skip"):
                            # Skip this step and move on
                            await self.broadcast(session_id, {
                                "type": "step:completed",
                                "step": step_name,
                                "result": {"summary": "已跳过",
                                           "artifactPaths": [],
                                           "previewData": None,
                                           "editableFields": []},
                            })
                            i += 1
                            continue
                        else:
                            # "confirm" or unknown → retry (don't increment i)
                            continue
                    except asyncio.TimeoutError:
                        logger.info("Workflow: error-resolution timeout for %s, retrying", step_name)
                        continue  # Retry on timeout
                    except Exception:
                        logger.exception("Workflow: error gate failed for %s", step_name)
                        i += 1  # Skip on gate failure
                        continue

                # ── Step succeeded ────────────────────────────────────

                # Skip confirmation for video_rendering (last step, auto-completes)
                if step_name == "video_rendering":
                    i += 1
                    continue

                # Request user confirmation before next step
                await self.broadcast(session_id, {
                    "type": "step:need_confirm",
                    "step": step_name,
                    "message": f"{step_name} 已完成，请审阅确认后进入下一步",
                    "suggestions": ["确认", "重新生成", "需要修改"],
                })

                logger.warning("Workflow: WAITING for confirmation on step %s (session %s)", step_name, session_id)
                try:
                    gate_result = await self._confirmation_gate.wait_for_confirmation(
                        session_id=session_id,
                        prompt=f"{step_name} 已完成，请确认",
                        timeout=1800.0,
                        step_name=step_name,
                        phase="after",  # V3: distinguish from pre-confirm gate (phase="before")
                    )
                    logger.warning("Workflow: GOT confirmation result for step %s: %s", step_name, gate_result.get("action"))
                    action = gate_result.get("action", "")
                    if action == "cancelled":
                        svc._index.update_stage(session_id, "cancelled", "用户取消")
                        return
                    elif action == "modify":
                        # User wants to modify — the modify handler will
                        # resume the gate and re-run the step.
                        # Don't increment i so we loop back to the same step.
                        logger.info(
                            "Workflow: user requested modify on %s, re-running",
                            step_name,
                        )
                        continue  # Re-run same step
                    # "confirm" or any other action → proceed
                except asyncio.TimeoutError:
                    logger.info(
                        "Workflow: confirmation timeout for %s, proceeding",
                        step_name,
                    )
                except Exception:
                    logger.exception(
                        "Workflow: confirmation gate error for %s, proceeding",
                        step_name,
                    )

                i += 1  # Move to next step

            # ── Workflow complete ─────────────────────────────────────
            # Preserve "rendered" stage from rendering pipeline if present
            final_stage = getattr(svc.get_session(session_id), "stage", "") or ""
            if final_stage not in ("rendered", "error", "cancelled"):
                final_stage = "narrative_planned"
            svc._index.update_stage(
                session_id, final_stage,
                "Step-by-step workflow complete",
            )
            await self.broadcast(session_id, {
                "type": "pipeline:complete",
                "stage": "completed",
                "session_id": session_id,
                "message": "所有步骤已完成",
            })

        except asyncio.CancelledError:
            logger.info("Workflow cancelled for %s", session_id)
            try:
                svc = get_session_service()
                svc._index.update_stage(session_id, "cancelled", "Workflow cancelled")
            except Exception:
                pass
        except Exception as exc:
            logger.exception("Workflow failed for session %s", session_id)
            try:
                await self.broadcast(session_id, {
                    "type": "pipeline_error",
                    "stage": "error",
                    "error": f"工作流出错: {exc}",
                })
            except Exception:
                logger.exception(
                    "Failed to broadcast workflow error for %s", session_id,
                )
