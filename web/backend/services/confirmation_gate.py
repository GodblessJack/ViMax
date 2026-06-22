"""Confirmation gate -- asyncio.Event-based pause/resume for Agent-driven workflows.

The Agent pauses at each confirmation point and waits for a user response
before proceeding.  The WebSocket handler calls resume() when it receives
a user:confirm / user:modify / user:message event.

V3 enhancements:
- Phase tracking ("before" | "after") for pre-step and post-step confirmations.
- pre_step_confirm() sends step:need_confirm_before via broadcast callback,
  then blocks on asyncio.Event.
- get_pending_state() returns unified pending confirmation state.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)


class ConfirmationGate:
    """One-shot gate that blocks the Agent until a user response arrives.

    Usage (Agent side — post-step confirmation)::

        result = await gate.wait_for_confirmation(
            session_id="...",
            prompt="Please confirm if the story outline is satisfactory?",
            context={"artifact": "story.txt", "stage": "develop_story"},
            phase="after",
        )
        # result == {"action": "confirm" | "modify" | "message", "payload": ...}

    Usage (Agent side — pre-step confirmation)::

        result = await gate.pre_step_confirm(
            session_id="...",
            step_name="story_generation",
            context={
                "params": {"idea": "...", "style": "comedy"},
                "estimatedDuration": "约 30 秒",
                "sideEffects": ["会创建 idea2video/story.txt"],
            },
        )
        # Sends step:need_confirm_before via broadcast callback, then blocks.
        # result == {"action": "confirm_before" | "reject_before", ...}

    Usage (WebSocket handler side)::

        gate.resume(session_id, {"action": "confirm", "payload": {}})
    """

    def __init__(self) -> None:
        self._events: dict[str, asyncio.Event] = {}
        self._results: dict[str, dict[str, Any]] = {}
        self._pending_prompts: dict[str, str] = {}     # session_id → prompt
        self._pending_steps: dict[str, str] = {}        # session_id → step_name (machine key)
        # ── V3: phase & context tracking ────────────────────────────────
        self._pending_phases: dict[str, str] = {}       # session_id → "before" | "after"
        self._pending_contexts: dict[str, dict[str, Any]] = {}  # session_id → context dict
        # ── V3: optional broadcast callback for sending WS events ───────
        self._broadcast_callback: Callable[..., Any] | None = None

    # ── V3: broadcast callback registration ─────────────────────────────

    def set_broadcast_callback(self, callback: Callable[..., Any]) -> None:
        """Register an async callable `callback(session_id, payload)` used to
        send WS events from within pre_step_confirm().

        Typically set to AgentService.broadcast during initialization.
        """
        self._broadcast_callback = callback

    # ── Agent-facing API ────────────────────────────────────────────────

    async def wait_for_confirmation(
        self,
        session_id: str,
        prompt: str,
        context: dict[str, Any] | None = None,
        timeout: float = 1800.0,  # 30 minutes default
        step_name: str = "",
        phase: str = "after",     # V3: "before" | "after"
    ) -> dict[str, Any]:
        """Block the Agent until the user responds or the timeout fires.

        Args:
            session_id: The session to block on.
            prompt: Human-readable confirmation question.
            context: Optional metadata about what is being confirmed.
            timeout: Seconds before auto-timeout (default 1800 = 30 min).
            step_name: Machine key for the step awaiting confirmation.
            phase: "before" for pre-step, "after" for post-step (default).

        Returns:
            On user response:  {"action": "confirm" | "modify" | "message",
                                "payload": <user data>, "reply": "<text>"}
            On timeout:        {"action": "timeout", "payload": {},
                                "reply": "等待超时"}
        """
        event = asyncio.Event()
        self._events[session_id] = event
        self._results.pop(session_id, None)
        self._pending_prompts[session_id] = prompt
        self._pending_steps[session_id] = step_name or prompt
        # ── V3: track phase and context ─────────────────────────────────
        self._pending_phases[session_id] = phase
        self._pending_contexts[session_id] = context or {}

        logger.warning(
            "ConfirmationGate: WAITING for session %s phase=%s step=%s (prompt=%.80s, timeout=%s)",
            session_id, phase, step_name, prompt, timeout,
        )
        try:
            await asyncio.wait_for(event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            logger.warning("Confirmation timeout for session %s (prompt=%.80s)", session_id, prompt)
            self._results[session_id] = {
                "action": "timeout",
                "payload": {},
                "reply": "等待超时",
            }
        else:
            logger.warning("ConfirmationGate: RESOLVED for session %s", session_id)
        finally:
            self._events.pop(session_id, None)
            self._pending_prompts.pop(session_id, None)
            self._pending_steps.pop(session_id, None)
            self._pending_phases.pop(session_id, None)
            self._pending_contexts.pop(session_id, None)

        return self._results.pop(
            session_id,
            {"action": "timeout", "payload": {}, "reply": "未知错误"},
        )

    # ── V3: pre-step confirmation ──────────────────────────────────────

    async def pre_step_confirm(
        self,
        session_id: str,
        step_name: str,
        context: dict[str, Any] | None = None,
        timeout: float = 1800.0,
    ) -> dict[str, Any]:
        """Send step:need_confirm_before via broadcast callback, then block
        until the user responds or the timeout fires.

        The caller (Agent tool) invokes this before calling PipelineService
        to execute a step, giving the user a chance to review parameters and
        approve/reject the execution.

        Args:
            session_id: The session to block on.
            step_name: The step about to be executed (e.g. "story_generation").
            context: Parameters and metadata for the user to review.
                Expected keys: params, estimatedDuration, dependencies, sideEffects.
            timeout: Seconds before auto-timeout (default 1800 = 30 min).

        Returns:
            On user confirm:  {"action": "confirm_before", "step": <step_name>,
                               "payload": {}, "reply": "<text>"}
            On user reject:   {"action": "reject_before", "step": <step_name>,
                               "payload": <modified_params>, "reply": "<text>"}
            On timeout:       {"action": "timeout", "payload": {},
                               "reply": "等待超时"}
        """
        ctx = context or {}

        # ── Send WS event to all connected clients ──────────────────────
        if self._broadcast_callback is not None:
            try:
                await self._broadcast_callback(session_id, {
                    "type": "step:need_confirm_before",
                    "step": step_name,
                    "session_id": session_id,
                    "phase": "before",
                    "message": f"即将开始 {step_name}，参数如下:",
                    "context": {
                        "stepName": step_name,
                        "params": ctx.get("params", {}),
                        "estimatedDuration": ctx.get("estimatedDuration", "未知"),
                        "dependencies": ctx.get("dependencies", []),
                        "sideEffects": ctx.get("sideEffects", []),
                    },
                    "source": "agent",
                })
            except Exception:
                logger.exception(
                    "pre_step_confirm: broadcast failed for session %s step %s",
                    session_id, step_name,
                )
                # Fail-open: proceed to block even if broadcast fails

        # ── Block on Event (same mechanism as wait_for_confirmation) ────
        event = asyncio.Event()
        self._events[session_id] = event
        self._results.pop(session_id, None)
        self._pending_prompts[session_id] = f"Pre-step confirm: {step_name}"
        self._pending_steps[session_id] = step_name
        self._pending_phases[session_id] = "before"
        self._pending_contexts[session_id] = ctx

        logger.warning(
            "ConfirmationGate: PRE_STEP WAITING for session %s step=%s (timeout=%s)",
            session_id, step_name, timeout,
        )
        try:
            await asyncio.wait_for(event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            logger.warning(
                "ConfirmationGate: PRE_STEP timeout for session %s step=%s",
                session_id, step_name,
            )
            self._results[session_id] = {
                "action": "timeout",
                "payload": {},
                "reply": "等待超时",
            }
        else:
            logger.warning(
                "ConfirmationGate: PRE_STEP RESOLVED for session %s step=%s",
                session_id, step_name,
            )
        finally:
            self._events.pop(session_id, None)
            self._pending_prompts.pop(session_id, None)
            self._pending_steps.pop(session_id, None)
            self._pending_phases.pop(session_id, None)
            self._pending_contexts.pop(session_id, None)

        return self._results.pop(
            session_id,
            {"action": "timeout", "payload": {}, "reply": "未知错误"},
        )

    # ── V3: pending state introspection ─────────────────────────────────

    def get_pending_state(self, session_id: str) -> dict[str, Any]:
        """Return the current pending confirmation state for a session.

        Returns a dict with the following shape:
            {
                "waiting": bool,           # True if Agent is blocked on confirmation
                "step_name": str | None,   # Machine step name, or None
                "phase": "before" | "after" | None,  # Confirmation phase
                "context": dict | None,    # Confirmation context (params, etc.)
            }
        """
        ev = self._events.get(session_id)
        waiting = ev is not None and not ev.is_set()
        if not waiting:
            return {
                "waiting": False,
                "step_name": None,
                "phase": None,
                "context": None,
            }
        return {
            "waiting": True,
            "step_name": self._pending_steps.get(session_id),
            "phase": self._pending_phases.get(session_id),
            "context": self._pending_contexts.get(session_id),
        }

    def get_pending_confirmations(self) -> list[dict[str, Any]]:
        """Return a list of all sessions currently waiting for confirmation.

        Each entry is the same dict shape as get_pending_state().
        """
        result: list[dict[str, Any]] = []
        for sid, ev in self._events.items():
            if ev is not None and not ev.is_set():
                result.append({
                    "session_id": sid,
                    "waiting": True,
                    "step_name": self._pending_steps.get(sid),
                    "phase": self._pending_phases.get(sid),
                    "context": self._pending_contexts.get(sid),
                })
        return result

    def is_any_waiting(self) -> bool:
        """Return True if any session is currently waiting for confirmation."""
        for ev in self._events.values():
            if ev is not None and not ev.is_set():
                return True
        return False

    # ── WebSocket handler-facing API ────────────────────────────────────

    def resume(self, session_id: str, result: dict[str, Any]) -> None:
        """Deliver the user's response and unblock the Agent.

        Called by the WebSocket event handler when a user:confirm,
        user:modify, user:message, user:confirm_before, or
        user:reject_before event arrives.
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

    def waiting_step(self, session_id: str) -> str | None:
        """Return the machine step name that is awaiting confirmation, or None."""
        ev = self._events.get(session_id)
        if ev is not None and not ev.is_set():
            return self._pending_steps.get(session_id)
        return None

    def waiting_phase(self, session_id: str) -> str | None:
        """Return the confirmation phase ("before" | "after") for a pending
        confirmation, or None if no confirmation is pending."""
        ev = self._events.get(session_id)
        if ev is not None and not ev.is_set():
            return self._pending_phases.get(session_id)
        return None

    def cancel(self, session_id: str) -> None:
        """Cancel a pending confirmation (e.g. on pipeline abort)."""
        self._results[session_id] = {
            "action": "cancelled",
            "payload": {},
            "reply": "操作已取消",
        }
        self._pending_prompts.pop(session_id, None)
        self._pending_steps.pop(session_id, None)
        self._pending_phases.pop(session_id, None)
        self._pending_contexts.pop(session_id, None)
        ev = self._events.get(session_id)
        if ev is not None:
            ev.set()
        logger.debug("Cancelled confirmation gate for session %s", session_id)
