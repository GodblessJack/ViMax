"""WebSocket router for real-time pipeline progress streaming."""

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_service():
    from web.backend.main import get_pipeline_service
    return get_pipeline_service()


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
        # Keep the connection alive — receive pings and discard
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WebSocket error for session %s", session_id)
    finally:
        svc.unregister_ws(session_id, websocket)
