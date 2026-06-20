"""Confirmation gate -- asyncio.Event-based pause/resume for Agent-driven workflows.

The Agent pauses at each confirmation point and waits for a user response
before proceeding.  The WebSocket handler calls resume() when it receives
a user:confirm / user:modify / user:message event.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

logger = logging.getLogger(__name__)


class ConfirmationGate:
    """One-shot gate that blocks the Agent until a user response arrives.

    Usage (Agent side)::

        result = await gate.wait_for_confirmation(
            session_id="...",
            prompt="Please confirm if the story outline is satisfactory?",
            context={"artifact": "story.txt", "stage": "develop_story"},
        )
        # result == {"action": "confirm" | "modify" | "message", "payload": ...}

    Usage (WebSocket handler side)::

        gate.resume(session_id, {"action": "confirm", "payload": {}})
    """

    def __init__(self) -> None:
        self._events: dict[str, asyncio.Event] = {}
        self._results: dict[str, dict[str, Any]] = {}

    # ── Agent-facing API ────────────────────────────────────────────────

    async def wait_for_confirmation(
        self,
        session_id: str,
        prompt: str,
        context: dict[str, Any] | None = None,
        timeout: float = 1800.0,  # 30 minutes default
    ) -> dict[str, Any]:
        """Block the Agent until the user responds or the timeout fires.

        Returns:
            On user response:  {"action": "confirm" | "modify" | "message",
                                "payload": <user data>, "reply": "<text>"}
            On timeout:        {"action": "timeout", "payload": {},
                                "reply": "等待超时"}
        """
        event = asyncio.Event()
        self._events[session_id] = event
        self._results.pop(session_id, None)

        try:
            await asyncio.wait_for(event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            logger.warning("Confirmation timeout for session %s (prompt=%.80s)", session_id, prompt)
            self._results[session_id] = {
                "action": "timeout",
                "payload": {},
                "reply": "等待超时",
            }
        finally:
            self._events.pop(session_id, None)

        return self._results.pop(
            session_id,
            {"action": "timeout", "payload": {}, "reply": "未知错误"},
        )

    # ── WebSocket handler-facing API ────────────────────────────────────

    def resume(self, session_id: str, result: dict[str, Any]) -> None:
        """Deliver the user's response and unblock the Agent.

        Called by the WebSocket event handler when a user:confirm,
        user:modify, or user:message event arrives.
        """
        self._results[session_id] = result
        event = self._events.get(session_id)
        if event is not None:
            event.set()
            logger.debug("Resumed confirmation gate for session %s", session_id)
        else:
            logger.warning(
                "No pending confirmation for session %s -- event discarded",
                session_id,
            )

    def is_waiting(self, session_id: str) -> bool:
        """Return True if the Agent is currently blocked on this session."""
        ev = self._events.get(session_id)
        return ev is not None and not ev.is_set()

    def cancel(self, session_id: str) -> None:
        """Cancel a pending confirmation (e.g. on pipeline abort)."""
        self._results[session_id] = {
            "action": "cancelled",
            "payload": {},
            "reply": "操作已取消",
        }
        ev = self._events.get(session_id)
        if ev is not None:
            ev.set()
        logger.debug("Cancelled confirmation gate for session %s", session_id)
