"""Pipeline plan/render/cancel router."""

from typing import Any

from fastapi import APIRouter, HTTPException

from web.backend.models.api_models import (
    PipelinePlanRequest, PipelineRenderRequest, PipelineStartResponse,
)

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])


def _get_service():
    from web.backend.main import get_pipeline_service
    return get_pipeline_service()


@router.post("/plan", response_model=PipelineStartResponse, status_code=202)
async def start_planning(body: PipelinePlanRequest):
    """Start the AI planning phase for a session.

    .. deprecated::
        This endpoint is DEPRECATED and will be removed in a future release.
        Planning is now driven by the Agent's ``run_step`` tool via WebSocket.
        See architecture-v2-design.md Section 6.4.
    """
    try:
        return await _get_service().start_planning(body)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.post("/render", response_model=PipelineStartResponse, status_code=202)
async def start_rendering(body: PipelineRenderRequest):
    """Start the rendering phase for a session.

    .. deprecated::
        This endpoint is DEPRECATED and will be removed in a future release.
        Rendering is now driven by the Agent's ``run_step`` tool via WebSocket.
        See architecture-v2-design.md Section 6.4.
    """
    try:
        return await _get_service().start_rendering(body)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.post("/start-workflow", response_model=PipelineStartResponse, status_code=202)
async def start_workflow(body: PipelinePlanRequest):
    """Start step-by-step workflow with confirmation gates between each step."""
    from web.backend.main import get_pipeline_service, get_agent_service
    # First create session via pipeline service (fast)
    resp = await _get_service().start_planning(body)
    sid = resp.session_id
    # Then kick off step-by-step Agent workflow
    asvc = get_agent_service()
    await asvc.start_workflow(
        session_id=sid,
        idea=body.idea,
        style=getattr(body, 'style', 'wuxia'),
        user_requirement=getattr(body, 'user_requirement', ''),
    )
    return resp


@router.post("/cancel/{session_id}")
async def cancel_pipeline(session_id: str):
    result = await _get_service().cancel_pipeline(session_id)
    if result.get("error"):
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@router.get("/confirm-status/{session_id}")
async def get_confirm_status(session_id: str):
    """REST fallback: check if a step is waiting for user confirmation.

    Returns { waiting: bool, step: string|null } so the frontend can
    show the correct step result panel and confirm/regenerate buttons
    even when WebSocket isn't connected.
    """
    from web.backend.main import get_agent_service
    asvc = get_agent_service()
    step = asvc.confirmation_gate.waiting_step(session_id)
    return {"waiting": step is not None, "step": step}


@router.post("/confirm/{session_id}")
async def confirm_step(session_id: str, body: dict[str, Any] | None = None):
    """REST fallback: confirm the current step (unblock the confirmation gate)."""
    from web.backend.main import get_agent_service
    asvc = get_agent_service()
    payload = body or {}
    await asvc.handle_confirm(session_id, payload)
    return {"status": "confirmed"}
