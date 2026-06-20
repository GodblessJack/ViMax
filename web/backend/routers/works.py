"""Works management router."""

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from web.backend.services.session_service import SessionService
from web.backend.services.workspace_service import WorkspaceService
from web.backend.models.api_models import WorkItem, WorkListResponse

router = APIRouter(prefix="/api/works", tags=["works"])


def _get_services():
    from web.backend.main import get_session_service, get_workspace_service
    return get_session_service(), get_workspace_service()


@router.get("", response_model=WorkListResponse)
async def list_works(search: str = "", limit: int = 50, offset: int = 0):
    session_svc, workspace_svc = _get_services()
    # Only return rendered/completed sessions
    result = session_svc.list_sessions(search=search, stage="rendered", limit=limit, offset=offset)
    items = []
    for s in result.items:
        items.append(WorkItem(
            session_id=s.session_id,
            idea=s.idea,
            style=s.style,
            created_at=s.created_at,
            updated_at=s.updated_at,
            duration_seconds=None,  # Could be extracted from video metadata later
            shot_count=0,           # Could be counted from workdir
            thumbnail_url=workspace_svc.get_thumbnail_url(s.session_id),
        ))
    return WorkListResponse(items=items, total=result.total)


@router.get("/{session_id}/download")
async def download_work(session_id: str):
    _, workspace_svc = _get_services()
    # Try idea2video final first, then scene 0 final
    for rel in ["idea2video/final_video.mp4", "idea2video/scene_0/final_video.mp4", "script2video/final_video.mp4"]:
        file_path = workspace_svc.resolve_path(session_id, rel)
        if file_path is not None:
            return FileResponse(
                file_path,
                media_type="video/mp4",
                filename=f"vimax_{session_id}.mp4",
                headers={"Content-Disposition": f'attachment; filename="vimax_{session_id}.mp4"'},
            )
    raise HTTPException(status_code=404, detail="No video found for this session")
