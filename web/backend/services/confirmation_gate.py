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
        # Per-phase event tracking (V3): key=(session_id, phase) tuple
        # Allows simultaneous "before" and "after" confirmations on the same session.
        self._events: dict[tuple[str, str], asyncio.Event] = {}
        self._results: dict[tuple[str, str], dict[str, Any]] = {}
        self._pending_prompts: dict[tuple[str, str], str] = {}     # (sid,phase) → prompt
        self._pending_steps: dict[tuple[str, str], str] = {}       # (sid,phase) → step_name
        # ── V3: phase & context tracking (also per-phase) ────────────────
        # session_id → current active phase ("before"|"after")
        # Design constraint: only ONE phase is active per session at a time.
        # The V3 workflow is strictly sequential — pre-confirm (before) resolves
        # before post-confirm (after) is created.  Concurrent phases would
        # overwrite each other; callers must ensure sequential use.
        self._pending_phases: dict[str, str] = {}
        self._pending_contexts: dict[tuple[str, str], dict[str, Any]] = {}  # (sid,phase) → context dict
        # ── V3: optional broadcast callback for sending WS events ───────
        self._broadcast_callback: Callable[..., Any] | None = None

    # ── Internal helpers ──────────────────────────────────────────────

    def _key(self, session_id: str, phase: str | None = None) -> tuple[str, str]:
        """Generate event key. If phase is None, auto-detect from pending_phases.

        Falls back to "after" when no pending phase is recorded (e.g. legacy
        callers that don't supply a phase).
        """
        if phase is None:
            phase = self._pending_phases.get(session_id, "after")
        return (session_id, phase)

    def _keys_for_session(self, session_id: str) -> list[tuple[str, str]]:
        """Return all compound keys for a session (across all phases)."""
        return [k for k in self._events if k[0] == session_id]

    async def _broadcast_state(self, session_id: str, state: dict[str, Any]) -> None:
        """Send sync:confirmation_state to connected clients (if callback registered)."""
        if self._broadcast_callback is not None:
            try:
                await self._broadcast_callback(session_id, {
                    "type": "sync:confirmation_state",
                    "session_id": session_id,
                    "state": state,
                })
            except Exception:
                logger.exception(
                    "Failed to broadcast sync:confirmation_state for session %s",
                    session_id,
                )

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
        key = self._key(session_id, phase)
        event = asyncio.Event()
        self._events[key] = event
        self._results.pop(key, None)
        self._pending_prompts[key] = prompt
        self._pending_steps[key] = step_name or prompt
        # ── V3: track phase and context ─────────────────────────────────
        self._pending_phases[session_id] = phase
        self._pending_contexts[key] = context or {}

        logger.warning(
            "ConfirmationGate: WAITING for session %s phase=%s step=%s (prompt=%.80s, timeout=%s)",
            session_id, phase, step_name, prompt, timeout,
        )
        try:
            await asyncio.wait_for(event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            logger.warning("Confirmation timeout for session %s phase=%s (prompt=%.80s)", session_id, phase, prompt)
            self._results[key] = {
                "action": "timeout",
                "payload": {},
                "reply": "等待超时",
            }
            # ── V3: broadcast sync:confirmation_state to clear stale UI ──
            await self._broadcast_state(session_id, {
                "isPending": False,
                "phase": None,
                "stepName": None,
                "stepIndex": None,
                "message": None,
                "suggestions": [],
                "lastConfirmationSource": None,
                "confirmedBy": None,
                "timestamp": None,
                "timeoutAt": None,
            })
        else:
            logger.warning("ConfirmationGate: RESOLVED for session %s phase=%s", session_id, phase)
        finally:
            self._events.pop(key, None)
            self._pending_prompts.pop(key, None)
            self._pending_steps.pop(key, None)
            self._pending_contexts.pop(key, None)

        return self._results.pop(
            key,
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

        # ── Block on Event (per-phase keying) ────────────────────────
        phase = "before"
        key = self._key(session_id, phase)
        event = asyncio.Event()
        self._events[key] = event
        self._results.pop(key, None)
        self._pending_prompts[key] = f"Pre-step confirm: {step_name}"
        self._pending_steps[key] = step_name
        self._pending_phases[session_id] = phase
        self._pending_contexts[key] = ctx

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
            self._results[key] = {
                "action": "timeout",
                "payload": {},
                "reply": "等待超时",
            }
            # ── V3: broadcast sync:confirmation_state to clear stale UI ──
            await self._broadcast_state(session_id, {
                "isPending": False,
                "phase": None,
                "stepName": None,
                "stepIndex": None,
                "message": None,
                "suggestions": [],
                "lastConfirmationSource": None,
                "confirmedBy": None,
                "timestamp": None,
                "timeoutAt": None,
            })
        else:
            logger.warning(
                "ConfirmationGate: PRE_STEP RESOLVED for session %s step=%s",
                session_id, step_name,
            )
        finally:
            self._events.pop(key, None)
            self._pending_prompts.pop(key, None)
            self._pending_steps.pop(key, None)
            self._pending_contexts.pop(key, None)

        return self._results.pop(
            key,
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
        # Check all phases for this session (per-phase keying)
        phase = self._pending_phases.get(session_id)
        if phase is None:
            return {
                "waiting": False,
                "step_name": None,
                "phase": None,
                "context": None,
            }
        key = (session_id, phase)
        ev = self._events.get(key)
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
            "step_name": self._pending_steps.get(key),
            "phase": phase,
            "context": self._pending_contexts.get(key),
        }

    def get_pending_confirmations(self) -> list[dict[str, Any]]:
        """Return a list of all sessions currently waiting for confirmation.

        Each entry is the same dict shape as get_pending_state().
        """
        result: list[dict[str, Any]] = []
        seen_sids: set[str] = set()
        for (sid, phase), ev in self._events.items():
            if ev is not None and not ev.is_set():
                if sid not in seen_sids:
                    seen_sids.add(sid)
                    result.append({
                        "session_id": sid,
                        "waiting": True,
                        "step_name": self._pending_steps.get((sid, phase)),
                        "phase": phase,
                        "context": self._pending_contexts.get((sid, phase)),
                    })
        return result

    def is_any_waiting(self) -> bool:
        """Return True if any session is currently waiting for confirmation."""
        for ev in self._events.values():
            if ev is not None and not ev.is_set():
                return True
        return False

    # ── WebSocket handler-facing API ────────────────────────────────────

    def resume(self, session_id: str, result: dict[str, Any], phase: str | None = None) -> None:
        """Deliver the user's response and unblock the Agent.

        Called by the WebSocket event handler when a user:confirm,
        user:modify, user:message, user:confirm_before, or
        user:reject_before event arrives.

        Args:
            session_id: The session to resume.
            result: The result dict (action, payload, reply).
            phase: Optional phase hint. If None, auto-detected from
                   _pending_phases (backward compatible).
        """
        key = self._key(session_id, phase)
        self._results[key] = result
        event = self._events.get(key)
        if event is not None:
            event.set()
            logger.debug("Resumed confirmation gate for session %s phase=%s", session_id, key[1])
            self._schedule_broadcast_clear(session_id)
        else:
            # Fallback: try legacy session_id-only lookup for callers that
            # don't have phase context (e.g. generic handle_confirm).
            for k in self._keys_for_session(session_id):
                self._results[k] = result
                ev = self._events.get(k)
                if ev is not None:
                    ev.set()
                    logger.debug("Resumed confirmation gate for session %s phase=%s (fallback)", session_id, k[1])
                    self._schedule_broadcast_clear(session_id)
                    return
            logger.warning(
                "No pending confirmation for session %s (tried phase=%s) -- event discarded",
                session_id, key[1],
            )

    def _schedule_broadcast_clear(self, session_id: str) -> None:
        """Schedule an async broadcast to clear confirmation state on all panels.

        Called from resume() after the gate is resolved. Uses fire-and-forget
        pattern (like cancel_sync) to avoid blocking synchronous callers.
        """
        import asyncio as _asyncio
        try:
            loop = _asyncio.get_running_loop()
            loop.create_task(self._broadcast_state(session_id, {
                "isPending": False,
                "phase": None,
                "stepName": None,
                "stepIndex": None,
                "message": None,
                "suggestions": [],
                "lastConfirmationSource": None,
                "confirmedBy": None,
                "timestamp": None,
                "timeoutAt": None,
            }))
        except RuntimeError:
            pass  # No running loop — skip broadcast

    def is_waiting(self, session_id: str, phase: str | None = None) -> bool:
        """Return True if the Agent is currently blocked on this session.

        Args:
            session_id: The session to check.
            phase: Optional phase to check. If None, checks any phase
                   (backward compatible).
        """
        if phase is not None:
            key = (session_id, phase)
            ev = self._events.get(key)
            return ev is not None and not ev.is_set()
        # Check all phases for this session
        for k in self._keys_for_session(session_id):
            ev = self._events.get(k)
            if ev is not None and not ev.is_set():
                return True
        return False

    def waiting_step(self, session_id: str) -> str | None:
        """Return the machine step name that is awaiting confirmation, or None."""
        phase = self._pending_phases.get(session_id)
        if phase is None:
            return None
        key = (session_id, phase)
        ev = self._events.get(key)
        if ev is not None and not ev.is_set():
            return self._pending_steps.get(key)
        return None

    def waiting_phase(self, session_id: str) -> str | None:
        """Return the confirmation phase ("before" | "after") for a pending
        confirmation, or None if no confirmation is pending."""
        return self._pending_phases.get(session_id)

    async def cancel(self, session_id: str, phase: str | None = None) -> None:
        """Cancel a pending confirmation (e.g. on pipeline abort).

        Broadcasts sync:confirmation_state to clear stale UI on connected clients.
        Safe to call from both sync and async contexts (broadcast is best-effort).

        Args:
            session_id: The session to cancel.
            phase: Optional phase to cancel. If None, cancels all phases
                   for the session.
        """
        if phase is not None:
            keys = [(session_id, phase)]
        else:
            keys = self._keys_for_session(session_id)

        for key in keys:
            self._results[key] = {
                "action": "cancelled",
                "payload": {},
                "reply": "操作已取消",
            }
            self._pending_prompts.pop(key, None)
            self._pending_steps.pop(key, None)
            self._pending_contexts.pop(key, None)
            ev = self._events.get(key)
            if ev is not None:
                ev.set()

        # Clear pending phase for this session
        self._pending_phases.pop(session_id, None)

        # ── V3: broadcast sync:confirmation_state to clear stale UI ──
        # Use best-effort scheduling so this works from both sync and async callers.
        await self._broadcast_state(session_id, {
            "isPending": False,
            "phase": None,
            "stepName": None,
            "stepIndex": None,
            "message": None,
            "suggestions": [],
            "lastConfirmationSource": None,
            "confirmedBy": None,
            "timestamp": None,
            "timeoutAt": None,
        })

        logger.debug("Cancelled confirmation gate for session %s (phases: %s)", session_id, [k[1] for k in keys])

    def cancel_sync(self, session_id: str, phase: str | None = None) -> None:
        """Synchronous wrapper for cancel() that fires-and-forgets the broadcast.

        Use this from sync contexts (e.g. cleanup_session).
        """
        import asyncio as _asyncio
        try:
            loop = _asyncio.get_running_loop()
            loop.create_task(self.cancel(session_id, phase))
        except RuntimeError:
            # No running event loop — skip the broadcast, just clear local state
            if phase is not None:
                keys = [(session_id, phase)]
            else:
                keys = self._keys_for_session(session_id)
            for key in keys:
                self._results[key] = {
                    "action": "cancelled",
                    "payload": {},
                    "reply": "操作已取消",
                }
                self._pending_prompts.pop(key, None)
                self._pending_steps.pop(key, None)
                self._pending_contexts.pop(key, None)
                ev = self._events.get(key)
                if ev is not None:
                    ev.set()
            self._pending_phases.pop(session_id, None)
            logger.debug("Cancelled confirmation gate for session %s (sync, no broadcast)", session_id)
