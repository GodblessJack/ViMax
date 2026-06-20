from __future__ import annotations

from pathlib import Path

from agent_runtime.session_index import SessionIndex


class WorkspaceService:
    """Service for reading workspace artifacts and serving files.

    Resolves session file paths safely (within the session working directory)
    and provides helper methods for common artifact lookups like thumbnails.
    """

    def __init__(self, vi_max_root: str) -> None:
        self._session_index = SessionIndex(vi_max_root)

    # ------------------------------------------------------------------
    # public API
    # ------------------------------------------------------------------

    def resolve_path(self, session_id: str, relative_path: str) -> Path | None:
        """Resolve *relative_path* within the session's working directory.

        Returns the absolute ``Path`` if the resolved location exists and is
        safely contained inside the session's working directory; ``None``
        otherwise (missing file or path-traversal attempt).
        """
        try:
            working_dir = self._session_index.working_dir(session_id)
        except (KeyError, ValueError):
            return None

        resolved = (working_dir / relative_path).resolve()

        # Security: ensure the resolved path is inside working_dir.
        if working_dir not in resolved.parents and resolved != working_dir:
            return None

        return resolved if resolved.exists() else None

    def get_file_path(self, session_id: str, relative_path: str) -> Path | None:
        """Alias for :meth:`resolve_path`."""
        return self.resolve_path(session_id, relative_path)

    def count_shots(self, session_id: str) -> int:
        """Count total shots across all scenes in the session."""
        try:
            working_dir = self._session_index.working_dir(session_id)
        except (KeyError, ValueError):
            return 0
        total = 0
        for pipeline in ("idea2video", "script2video"):
            pipeline_dir = working_dir / pipeline
            if not pipeline_dir.is_dir():
                continue
            for scene_dir in sorted(pipeline_dir.glob("scene_*")):
                if scene_dir.is_dir():
                    shots = list((scene_dir / "shots").glob("*/shot_description.json"))
                    total += len(shots)
        return total

    def get_thumbnail_url(self, session_id: str) -> str | None:
        """Return an API thumbnail URL for the session's first frame, if it exists.

        Checks both ``idea2video`` and ``script2video`` pipeline paths.
        """
        for pipeline in ("idea2video", "script2video"):
            candidate = f"{pipeline}/scene_0/shots/0/first_frame.png"
            thumbnail_path = self.resolve_path(session_id, candidate)
            if thumbnail_path is not None:
                return f"/api/files/{session_id}/{candidate}"
        return None

    def mime_type(self, file_path: Path) -> str:
        """Return a MIME type string for *file_path* based on its suffix."""
        suffix = file_path.suffix.lower()
        return _MIME_MAP.get(suffix, "application/octet-stream")


# ------------------------------------------------------------------
# internal helpers
# ------------------------------------------------------------------

_MIME_MAP: dict[str, str] = {
    # images
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    # video
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    # audio
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
    # text / data
    ".txt": "text/plain",
    ".json": "application/json",
    ".jsonl": "application/jsonl",
    ".csv": "text/csv",
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".ts": "text/typescript",
    ".xml": "application/xml",
    ".yaml": "application/x-yaml",
    ".yml": "application/x-yaml",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".tar": "application/x-tar",
    ".gz": "application/gzip",
}
