"""File serving router — serves artifacts from session working directories."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from web.backend.services.workspace_service import WorkspaceService

router = APIRouter(prefix="/api/files", tags=["files"])


def _get_service() -> WorkspaceService:
    from web.backend.main import get_workspace_service
    return get_workspace_service()


# More-specific routes MUST be defined before the catch-all wildcard

@router.get("/{session_id}/final_video")
async def serve_final_video(session_id: str):
    """Serve the final video with automatic fallback (scene_0, script2video)."""
    svc = _get_service()
    for path in [
        "idea2video/final_video.mp4",
        "idea2video/scene_0/final_video.mp4",
        "script2video/final_video.mp4",
    ]:
        file_path = svc.resolve_path(session_id, path)
        if file_path is not None:
            return FileResponse(file_path, media_type="video/mp4")
    raise HTTPException(status_code=404, detail="No video found for this session")


@router.get("/{session_id}/{rest_of_path:path}")
async def serve_file(session_id: str, rest_of_path: str):
    svc = _get_service()
    file_path = svc.resolve_path(session_id, rest_of_path)
    if file_path is None:
        raise HTTPException(status_code=404, detail="File not found or access denied")
    return FileResponse(file_path, media_type=svc.mime_type(file_path))
