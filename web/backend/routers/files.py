"""File serving router — serves artifacts from session working directories."""

import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from web.backend.services.workspace_service import WorkspaceService

router = APIRouter(prefix="/api/files", tags=["files"])


def _normalize_session_id(session_id: str) -> str:
    """Strip characters unsafe for filesystem paths — defense-in-depth on top of SessionIndex."""
    return re.sub(r"[^a-zA-Z0-9_-]", "", str(session_id).strip())


def _get_service() -> WorkspaceService:
    from web.backend.main import get_workspace_service
    return get_workspace_service()


# More-specific routes MUST be defined before the catch-all wildcard

@router.get("/{session_id}/final_video")
async def serve_final_video(session_id: str):
    """Serve the final video with automatic fallback (scene_0, script2video)."""
    session_id = _normalize_session_id(session_id)
    svc = _get_service()
    for path in [
        "idea2video/final_video.mp4",
        "idea2video/scene_0/final_video.mp4",
        "script2video/final_video.mp4",
    ]:
        file_path = svc.resolve_path(session_id, path)
        if file_path is not None:
            return FileResponse(
                file_path,
                media_type="video/mp4",
                headers={"Cache-Control": "public, max-age=3600"},
            )
    raise HTTPException(status_code=404, detail="No video found for this session")


@router.get("/{session_id}/{rest_of_path:path}")
async def serve_file(session_id: str, rest_of_path: str):
    session_id = _normalize_session_id(session_id)
    svc = _get_service()
    file_path = svc.resolve_path(session_id, rest_of_path)
    if file_path is None:
        raise HTTPException(status_code=404, detail="File not found or access denied")
    mime = svc.mime_type(file_path)
    cache_age = "604800" if mime.startswith(("image/", "video/")) else "3600"
    return FileResponse(
        file_path,
        media_type=mime,
        headers={"Cache-Control": f"public, max-age={cache_age}"},
    )
