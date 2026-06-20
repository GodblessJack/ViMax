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

                # Announce step start
                await self.broadcast(session_id, {
                    "type": "pipeline:status",
                    "session_id": session_id,
                    "stage": step_name,
                    "message": f"Starting {step_name}",
                })

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

                try:
                    gate_result = await self._confirmation_gate.wait_for_confirmation(
                        session_id=session_id,
                        prompt=f"{step_name} 已完成，请确认",
                        timeout=1800.0,
                    )
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
            svc._index.update_stage(
                session_id, "narrative_planned",
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
                    "type": "pipeline:error",
                    "stage": "error",
                    "error": f"工作流出错: {exc}",
                })
            except Exception:
                logger.exception(
                    "Failed to broadcast workflow error for %s", session_id,
                )
