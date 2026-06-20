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

import anthropic

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

    def _get_client(self) -> anthropic.AsyncAnthropic:
        """Lazy-initialize the Anthropic client from ViMax LLM config."""
        if self._client is not None:
            return self._client

        from web.backend.config import backend_config
        from agent_runtime.config import llm_api_key, llm_base_url, llm_model

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

    def cleanup_session(self, session_id: str) -> None:
        """Release all resources for a session."""
        self._conversations.pop(session_id, None)
        self._confirmation_gate.cancel(session_id)
        self._ws_callbacks.pop(session_id, None)
        self._agent_tasks.pop(session_id, None)
