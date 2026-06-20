"""WebSocket router for real-time pipeline progress streaming.

Provides two endpoints:
  - /ws/pipeline/{session_id} — legacy endpoint used by usePipelineWebSocket
  - /ws/session/{session_id}  — unified endpoint used by useSessionWebSocket
    with bidirectional event support (client→server typed events)
"""

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter()
_WS_CLIENT_TIMEOUT = 300  # 5 minutes — disconnect idle clients


def _get_service():
    from web.backend.main import get_pipeline_service
    return get_pipeline_service()


# ── Legacy endpoint (unchanged) ──────────────────────────────────────────

@router.websocket("/ws/pipeline/{session_id}")
async def pipeline_websocket(websocket: WebSocket, session_id: str):
    await websocket.accept()
    svc = _get_service()
    svc.register_ws(session_id, websocket)
    try:
        # Send a welcome message
        await websocket.send_json({
            "type": "pipeline_status",
            "session_id": session_id,
            "stage": "connected",
            "phase": "ready",
            "message": "WebSocket connected, listening for pipeline events",
        })
        # Keep the connection alive — receive pings and discard; timeout idle clients
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


# ── Unified endpoint (new — bidirectional typed events) ──────────────────

CLIENT_EVENT_TYPES = frozenset({
    "user:confirm",
    "user:modify",
    "user:regenerate",
    "user:navigate",
    "user:message",
    "user:action",
    "ping",
})


@router.websocket("/ws/session/{session_id}")
async def session_websocket(websocket: WebSocket, session_id: str):
    """Unified WebSocket endpoint with typed client→server event support.

    Server → Client events (broadcast from pipeline):
      Same as existing pipeline events (step:*, pipeline:*, artifact:*, agent:*)

    Client → Server events (parsed and logged):
      user:confirm, user:modify, user:regenerate, user:navigate,
      user:message, user:action, ping
    """
    await websocket.accept()
    svc = _get_service()
    svc.register_ws(session_id, websocket)
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
                await _handle_client_event(websocket, session_id, data)
            except asyncio.TimeoutError:
                logger.info("Session WebSocket idle timeout for %s", session_id)
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Session WebSocket error for %s", session_id)
    finally:
        svc.unregister_ws(session_id, websocket)


async def _handle_client_event(
    websocket: WebSocket,
    session_id: str,
    raw: str,
) -> None:
    """Parse and handle a single client→server WebSocket event."""
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

    # ── Route client events to service handlers ────────────────────────
    # Future: dispatch user:confirm / user:modify / user:regenerate etc.
    # to the pipeline service for real-time interactivity.
    #
    # For now, log and acknowledge receipt.
    await websocket.send_json({
        "type": "event:ack",
        "event_type": event_type,
        "session_id": session_id,
    })
