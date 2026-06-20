"""Session CRUD router."""

from fastapi import APIRouter, HTTPException, Query

from web.backend.services.session_service import SessionService
from web.backend.models.api_models import (
    SessionCreateRequest, SessionDetail, SessionListResponse,
)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def _get_service() -> SessionService:
    from web.backend.main import get_session_service
    return get_session_service()


@router.get("", response_model=SessionListResponse)
async def list_sessions(
    search: str = "",
    stage: str = "",
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    return _get_service().list_sessions(search=search, stage=stage, limit=limit, offset=offset)


@router.get("/{session_id}", response_model=SessionDetail)
async def get_session(session_id: str):
    detail = _get_service().get_session(session_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return detail


@router.post("", response_model=SessionDetail, status_code=201)
async def create_session(body: SessionCreateRequest):
    return _get_service().create_session(
        idea=body.idea,
        user_requirement=body.user_requirement,
        style=body.style,
    )


@router.delete("/{session_id}")
async def delete_session(session_id: str):
    result = _get_service().delete_session(session_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result
