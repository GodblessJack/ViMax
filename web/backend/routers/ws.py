"""WebSocket router for real-time pipeline progress streaming.

Provides two endpoints:
  - /ws/pipeline/{session_id} — legacy endpoint used by usePipelineWebSocket
  - /ws/session/{session_id}  — unified endpoint used by useSessionWebSocket
    with bidirectional event support (client->server typed events)
"""

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter()
_WS_CLIENT_TIMEOUT = 300  # 5 minutes -- disconnect idle clients


def _get_pipeline_service():
    from web.backend.main import get_pipeline_service
    return get_pipeline_service()


def _get_agent_service():
    from web.backend.main import get_agent_service
    return get_agent_service()


# -- Legacy endpoint (unchanged) ----------------------------------------------

@router.websocket("/ws/pipeline/{session_id}")
async def pipeline_websocket(websocket: WebSocket, session_id: str):
    await websocket.accept()
    svc = _get_pipeline_service()
    svc.register_ws(session_id, websocket)

    # Also register with AgentService so step:* progress events reach this connection
    asvc = _get_agent_service()
    async def _ws_send(payload: dict) -> None:
        try:
            await websocket.send_json(payload)
        except Exception:
            pass
    asvc.register_ws_callback(session_id, _ws_send)
    try:
        # Send a welcome message
        await websocket.send_json({
            "type": "pipeline_status",
            "session_id": session_id,
            "stage": "connected",
            "phase": "ready",
            "message": "WebSocket connected, listening for pipeline events",
        })
        # Keep the connection alive -- receive pings and discard; timeout idle clients
        while True:
            try:
                data = await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=_WS_CLIENT_TIMEOUT,
                )
                if data == "ping":
                    await websocket.send_json({"type": "pong"})
            except asyncio.TimeoutError:
                logger.info("WebSocket idle timeout for session %s", session_id)
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WebSocket error for session %s", session_id)
    finally:
        svc.unregister_ws(session_id, websocket)
        asvc.unregister_ws_callback(session_id, _ws_send)


# -- Unified endpoint (Agent-driven bidirectional events) ---------------------

CLIENT_EVENT_TYPES = frozenset({
    "user:confirm",
    "user:modify",
    "user:regenerate",
    "user:navigate",
    "user:message",
    "user:action",
    "ping",
    # V3: pre-execution confirmation events
    "user:confirm_before",
    "user:reject_before",
})


# ── V3 Broadcast helpers ────────────────────────────────────────────────


async def broadcast_confirm_before(
    agent_service,
    session_id: str,
    step: str,
    message: str,
    context: dict,
) -> None:
    """Broadcast step:need_confirm_before to all WS connections for a session."""
    await agent_service.broadcast(session_id, {
        "type": "step:need_confirm_before",
        "step": step,
        "session_id": session_id,
        "phase": "before",
        "message": message,
        "context": context,
        "source": "agent",
    })


async def broadcast_pre_step_context(
    agent_service,
    session_id: str,
    step: str,
    current_progress: dict,
    available_artifacts: dict,
    agent_state: dict,
) -> None:
    """Broadcast step:pre_step_context to all WS connections for a session."""
    await agent_service.broadcast(session_id, {
        "type": "step:pre_step_context",
        "session_id": session_id,
        "step": step,
        "currentProgress": current_progress,
        "availableArtifacts": available_artifacts,
        "agentState": agent_state,
    })


async def broadcast_config_changed(
    agent_service,
    session_id: str,
    changed_by: str,
    source: str,
    changes: list,
    timestamp: int,
) -> None:
    """Broadcast sync:config_changed to all WS connections for a session."""
    await agent_service.broadcast(session_id, {
        "type": "sync:config_changed",
        "session_id": session_id,
        "changedBy": changed_by,
        "source": source,
        "changes": changes,
        "timestamp": timestamp,
    })


async def broadcast_confirmation_state(
    agent_service,
    session_id: str,
    state: dict,
) -> None:
    """Broadcast sync:confirmation_state to all WS connections for a session."""
    await agent_service.broadcast(session_id, {
        "type": "sync:confirmation_state",
        "session_id": session_id,
        "state": state,
    })


@router.websocket("/ws/session/{session_id}")
async def session_websocket(websocket: WebSocket, session_id: str):
    """Unified WebSocket endpoint with typed client->server event support.

    Server -> Client events (broadcast from Agent/Pipeline):
      Same as existing pipeline events (step:*, pipeline:*, artifact:*, agent:*)

    Client -> Server events (parsed and routed to AgentService):
      user:confirm  -> agent_service.handle_confirm()
      user:modify   -> agent_service.handle_modify()
      user:message  -> agent_service.handle_message()
      user:regenerate -> (planned)
      user:navigate -> agent_service.handle_navigate()
      user:action   -> agent_service.handle_action()
      ping          -> pong
      user:confirm_before -> agent_service.handle_confirm_before()  [V3]
      user:reject_before  -> agent_service.handle_reject_before()   [V3]
    """
    await websocket.accept()
    psvc = _get_pipeline_service()
    asvc = _get_agent_service()

    # Register with both services
    psvc.register_ws(session_id, websocket)

    # Register WS callback for AgentService broadcasts
    async def _ws_send(payload: dict) -> None:
        try:
            await websocket.send_json(payload)
        except Exception:
            pass

    asvc.register_ws_callback(session_id, _ws_send)

    try:
        # Send a welcome/connected event
        await websocket.send_json({
            "type": "connected",
            "session_id": session_id,
            "current_step": "",
            "session_stage": "created",
        })

        while True:
            try:
                data = await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=_WS_CLIENT_TIMEOUT,
                )
                await _handle_client_event(websocket, session_id, data, asvc)
            except asyncio.TimeoutError:
                logger.info("Session WebSocket idle timeout for %s", session_id)
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Session WebSocket error for %s", session_id)
    finally:
        psvc.unregister_ws(session_id, websocket)
        asvc.unregister_ws_callback(session_id, _ws_send)


async def _handle_client_event(
    websocket: WebSocket,
    session_id: str,
    raw: str,
    agent_service,
) -> None:
    """Parse and handle a single client->server WebSocket event.

    Routes user events to AgentService handlers and pipeline events
    to PipelineService.
    """
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Invalid JSON from client (session %s): %.200s", session_id, raw)
        return

    event_type = payload.get("type", "")

    if event_type not in CLIENT_EVENT_TYPES:
        logger.debug("Unknown client event type '%s' (session %s)", event_type, session_id)
        return

    if event_type == "ping":
        await websocket.send_json({"type": "pong"})
        return

    logger.info(
        "Client event [%s] session=%s payload=%s",
        event_type,
        session_id,
        json.dumps(payload, ensure_ascii=False)[:500],
    )

    try:
        if event_type == "user:message":
            message_text = payload.get("message", "") or payload.get("payload", {}).get("text", "")
            if message_text:
                confirmation_gate = agent_service.confirmation_gate if hasattr(agent_service, 'confirmation_gate') else None
                is_waiting = confirmation_gate.is_waiting(session_id) if confirmation_gate else False
                if is_waiting:
                    # Gate pending -- resume it with the user's text, do NOT start a new LLM call
                    await agent_service.handle_suggestion_reply(session_id, message_text)
                else:
                    # No gate -- normal message flow
                    result = await agent_service.handle_message(session_id, message_text)
                    await websocket.send_json({
                        "type": "agent:reply",
                        "session_id": session_id,
                        "reply": result.get("reply", ""),
                    })
            else:
                await websocket.send_json({
                    "type": "event:ack",
                    "event_type": event_type,
                    "session_id": session_id,
                })

        elif event_type == "user:confirm":
            user_payload = payload.get("payload", {})
            await agent_service.handle_confirm(session_id, user_payload)
            await websocket.send_json({
                "type": "agent:confirm_ack",
                "session_id": session_id,
            })

        elif event_type == "user:modify":
            user_payload = payload.get("payload", {})
            reply = payload.get("message", "") or payload.get("reply", "")
            await agent_service.handle_modify(session_id, user_payload, reply)

        elif event_type == "user:navigate":
            step_index = payload.get("step_index", 0)
            await agent_service.handle_navigate(session_id, step_index)

        elif event_type == "user:action":
            action = payload.get("action", "")
            action_payload = payload.get("payload", {})
            if action == "start_workflow":
                idea = payload.get("idea", "") or action_payload.get("idea", "")
                style = payload.get("style", "") or action_payload.get("style", "wuxia")
                requirement = payload.get("user_requirement", "") or action_payload.get("user_requirement", "")
                sid = payload.get("session_id", "") or action_payload.get("session_id", "") or session_id
                if idea and sid:
                    await websocket.send_json({
                        "type": "agent:workflow_started",
                        "session_id": sid,
                        "message": "Starting step-by-step workflow",
                    })
                    await agent_service.start_workflow(
                        session_id=sid, idea=idea, style=style,
                        user_requirement=requirement,
                    )
            else:
                await agent_service.handle_action(session_id, action, action_payload)

        elif event_type == "user:regenerate":
            step = payload.get("step", "")
            feedback = payload.get("feedback", "")
            await agent_service.handle_regenerate(session_id, step, feedback)

        # ── V3: Pre-execution confirmation handlers ──────────────────
        elif event_type == "user:confirm_before":
            step = payload.get("step", "")
            user_payload = payload.get("payload", {})
            reply = payload.get("reply", "")
            await agent_service.handle_confirm_before(
                session_id, step, user_payload, reply,
            )
            await websocket.send_json({
                "type": "agent:confirm_ack",
                "session_id": session_id,
                "step": step,
            })

        elif event_type == "user:reject_before":
            step = payload.get("step", "")
            user_payload = payload.get("payload", {})
            reply = payload.get("reply", "")
            await agent_service.handle_reject_before(
                session_id, step, user_payload, reply,
            )
            await websocket.send_json({
                "type": "agent:confirm_ack",
                "session_id": session_id,
                "step": step,
            })

    except Exception:
        logger.exception("Failed to handle client event %s for session %s", event_type, session_id)
        await websocket.send_json({
            "type": "event:error",
            "event_type": event_type,
            "session_id": session_id,
            "error": "处理消息时出错，请稍后重试",
        })
