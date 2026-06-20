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

工作流程:
1. 首先了解用户的创意想法和需求
2. 利用工具逐步完成: 故事开发 → 角色抽取 → 剧本创作 → 分镜规划 → 角色肖像生成 → 场景渲染
3. 每个步骤完成后，必须等待用户确认才能进入下一步
4. 主动给用户建议，但不替用户做决定

重要规则:
- 使用 get_session_state 了解当前会话状态
- 使用 read_artifact 读取已生成的产物
- 使用 run_step 执行每个流水线步骤
- 使用 request_confirmation 在每个步骤完成后请求用户确认
- 使用 ask_user 向用户提问以获取更多信息
- 使用 update_artifact 根据用户反馈修改产物内容
- 如果用户想重来，使用 restart_workflow
- 始终用中文与用户交流，保持简洁友好
- 不要替用户做创作决定，只给建议"""


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

        from web.backend.config import backend_config
        from agent_runtime.config import llm_api_key, llm_base_url

        root = str(backend_config.vi_max_root)
        api_key = llm_api_key(root)
        base_url = llm_base_url(root)

        # DashScope fallback
        ds_key = os.environ.get("DASHSCOPE_API_KEY", "")
        if ds_key and not api_key:
            api_key = ds_key
            base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"

        self._client = anthropic.AsyncAnthropic(
            api_key=api_key,
            base_url=base_url,
        )
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
        try:
            client = self._get_client()
            if client is None:
                return {"reply": "Agent chat requires the anthropic Python package."}
            conversation = self._get_or_create_conversation(session_id)

            conversation.append({"role": "user", "content": message})

            response = await client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=4096,
                system=AGENT_SYSTEM_PROMPT,
                messages=conversation,
                tools=build_tool_schemas(),
                tool_choice={"type": "auto"},
            )

            assistant_text = ""
            for block in response.content:
                if block.type == "text":
                    assistant_text += block.text
                    conversation.append({"role": "assistant", "content": block.text})
                elif block.type == "tool_use":
                    # Execute tool and append result
                    tool_result = await self._execute_tool(
                        session_id,
                        block.name,
                        block.input,
                    )
                    conversation.append({
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": block.id,
                                "content": json.dumps(tool_result, ensure_ascii=False),
                            }
                        ],
                    })

            return {"reply": assistant_text}
        except Exception as exc:
            logger.exception("Agent handle_message failed for session %s", session_id)
            return {"reply": f"抱歉，处理消息时出错: {exc}"}

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

    # ── Conversation management ─────────────────────────────────────────

    def _get_or_create_conversation(self, session_id: str) -> list[dict[str, Any]]:
        if session_id not in self._conversations:
            self._conversations[session_id] = []
        return self._conversations[session_id]

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
            self._confirmation_gate.cancel(session_id)
            from web.backend.main import get_session_service
            try:
                svc = get_session_service()
                svc._index.update_stage(session_id, "created", "User restarted workflow")
            except Exception:
                pass
        elif action == "cancel":
            self._confirmation_gate.cancel(session_id)
            self._conversations.pop(session_id, None)

    # ── Cleanup ─────────────────────────────────────────────────────────

    @property
    def confirmation_gate(self) -> ConfirmationGate:
        return self._confirmation_gate

    def cleanup_session(self, session_id: str) -> None:
        """Release all resources for a session."""
        self._conversations.pop(session_id, None)
        self._confirmation_gate.cancel(session_id)
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
        """Internal: execute pipeline steps one at a time with confirmation gates."""
        from web.backend.main import get_pipeline_service, get_session_service

        try:
            psvc = get_pipeline_service()
            svc = get_session_service()

            # Ensure session exists and is in 'created' stage
            detail = svc.get_session(session_id)
            if detail is None:
                await self.broadcast(session_id, {
                    "type": "step:error", "step": "init",
                    "error": "Session not found", "recoverable": False,
                })
                return

            # Update stage
            svc._index.update_stage(session_id, "narrative_planning", "Step-by-step planning started")
            logger.info("Workflow: starting step-by-step for session %s", session_id)

            logger.info("Workflow: building chat model for %s", session_id)
            chat_model = psvc._build_chat_model()
            logger.info("Workflow: chat model ready for %s", session_id)
            from web.backend.services.pipeline_service import _UnavailableGenerator
            dummy = _UnavailableGenerator()
            working_dir = str(svc._index.working_dir(session_id) / "idea2video")
            import os
            os.makedirs(working_dir, exist_ok=True)

            logger.info("Workflow: creating pipeline for %s", session_id)
            from pipelines.idea2video_pipeline import Idea2VideoPipeline
            pipeline = Idea2VideoPipeline(
                chat_model=chat_model,
                image_generator=dummy,
                video_generator=dummy,
                working_dir=working_dir,
            )
            logger.info("Workflow: pipeline ready for %s", session_id)

            # Step 1: develop_story
            step_name = "story_generation"
            await self.broadcast(session_id, {
                "type": "step:preparing", "step": step_name,
                "context": {"idea": idea[:200], "style": style},
            })
            await self.broadcast(session_id, {
                "type": "step:running", "step": step_name,
                "progress_percent": 0, "progress_message": "正在构思故事...",
            })
            logger.info("Workflow: executing story_generation for %s", session_id)
            story_text = await pipeline.develop_story(
                idea=idea, user_requirement=user_requirement, quiet=True,
            )
            logger.info("Workflow: story_generation completed, %d chars", len(story_text))
            await self.broadcast(session_id, {
                "type": "step:completed", "step": step_name,
                "result": {"summary": "故事构思完成", "artifactPaths": ["idea2video/story.txt"],
                           "previewData": story_text[:500], "editableFields": []},
            })
            await self.broadcast(session_id, {
                "type": "step:need_confirm", "step": step_name,
                "message": "故事构思已完成，请审阅确认后进入下一步",
                "suggestions": ["确认", "重新生成", "需要修改"],
            })

            # Wait for user confirmation
            user_resp = await self._confirmation_gate.wait_for_confirmation(
                session_id=session_id, prompt="故事构思已完成，请确认", timeout=1800.0,
            )
            if user_resp.get("action") == "cancelled":
                svc._index.update_stage(session_id, "cancelled", "用户取消")
                return

            # Step 2: extract_characters
            step_name = "character_extraction"
            await self.broadcast(session_id, {
                "type": "step:preparing", "step": step_name,
                "context": {"story_len": len(story_text)},
            })
            await self.broadcast(session_id, {
                "type": "step:running", "step": step_name,
                "progress_percent": 0, "progress_message": "正在提取角色...",
            })
            logger.info("Workflow: executing character_extraction for %s", session_id)
            characters = await pipeline.extract_characters(story=story_text, quiet=True)
            logger.info("Workflow: character_extraction completed, %d chars", len(str(characters)))
            await self.broadcast(session_id, {
                "type": "step:completed", "step": step_name,
                "result": {"summary": "角色设计完成", "artifactPaths": ["idea2video/characters.json"],
                           "previewData": str(characters)[:500], "editableFields": []},
            })
            await self.broadcast(session_id, {
                "type": "step:need_confirm", "step": step_name,
                "message": "角色设计已完成，请审阅确认后进入下一步",
                "suggestions": ["确认", "重新生成", "需要修改"],
            })

            # Wait for user confirmation
            user_resp = await self._confirmation_gate.wait_for_confirmation(
                session_id=session_id, prompt="角色设计已完成，请确认", timeout=1800.0,
            )
            if user_resp.get("action") == "cancelled":
                svc._index.update_stage(session_id, "cancelled", "用户取消")
                return

            # Step 3: write_script
            step_name = "script_writing"
            await self.broadcast(session_id, {
                "type": "step:preparing", "step": step_name,
                "context": {"character_count": len(characters) if isinstance(characters, list) else 0},
            })
            await self.broadcast(session_id, {
                "type": "step:running", "step": step_name,
                "progress_percent": 0, "progress_message": "正在编写剧本...",
            })
            logger.info("Workflow: executing script_writing for %s", session_id)
            script = await pipeline.write_script_based_on_story(
                story=story_text, user_requirement=user_requirement, quiet=True,
            )
            logger.info("Workflow: script_writing completed, %d scenes", len(script) if isinstance(script, list) else 0)
            await self.broadcast(session_id, {
                "type": "step:completed", "step": step_name,
                "result": {"summary": "剧本写作完成", "artifactPaths": ["idea2video/script.json"],
                           "previewData": str(script)[:500], "editableFields": []},
            })
            await self.broadcast(session_id, {
                "type": "step:need_confirm", "step": step_name,
                "message": "剧本写作已完成，请审阅确认后进入下一步",
                "suggestions": ["确认", "重新生成", "需要修改"],
            })

            # Wait for user confirmation
            user_resp = await self._confirmation_gate.wait_for_confirmation(
                session_id=session_id, prompt="剧本写作已完成，请确认", timeout=1800.0,
            )
            if user_resp.get("action") == "cancelled":
                svc._index.update_stage(session_id, "cancelled", "用户取消")
                return
                user_resp = await self._confirmation_gate.wait_for_confirmation(
                    session_id=session_id,
                    prompt=f"{step['label']}已完成，请确认",
                    timeout=1800.0,
                )

            # Mark planning complete
            svc._index.update_stage(session_id, "narrative_planned", "Step-by-step planning complete")
            await self.broadcast(session_id, {
                "type": "pipeline:complete",
                "stage": "narrative_planned",
                "message": "所有步骤已完成，可以开始渲染",
            })

        except asyncio.CancelledError:
            logger.info("Workflow cancelled for %s", session_id)
            svc = get_session_service()
            svc._index.update_stage(session_id, "cancelled", "Workflow cancelled")
        except Exception as exc:
            logger.exception("Workflow failed for session %s", session_id)
            try:
                await self.broadcast(session_id, {
                    "type": "pipeline:error",
                    "stage": "error",
                    "error": f"工作流出错: {exc}",
                })
            except Exception:
                logger.exception("Failed to broadcast workflow error for %s", session_id)
