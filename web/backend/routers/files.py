"""File serving router — serves artifacts from session working directories."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from web.backend.services.workspace_service import WorkspaceService

router = APIRouter(prefix="/api/files", tags=["files"])


def _get_service() -> WorkspaceService:
    from web.backend.main import get_workspace_service
    return get_workspace_service()


@router.get("/{session_id}/{rest_of_path:path}")
async def serve_file(session_id: str, rest_of_path: str):
    svc = _get_service()
    file_path = svc.resolve_path(session_id, rest_of_path)
    if file_path is None:
        raise HTTPException(status_code=404, detail="File not found or access denied")
    return FileResponse(file_path, media_type=svc.mime_type(file_path))
