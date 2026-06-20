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


@router.post("/cancel/{session_id}")
async def cancel_pipeline(session_id: str):
    result = await _get_service().cancel_pipeline(session_id)
    if result.get("error"):
        raise HTTPException(status_code=404, detail=result["error"])
    return result
