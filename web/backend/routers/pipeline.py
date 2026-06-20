"""Pipeline plan/render/cancel router."""

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
    try:
        return await _get_service().start_planning(body)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.post("/render", response_model=PipelineStartResponse, status_code=202)
async def start_rendering(body: PipelineRenderRequest):
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
