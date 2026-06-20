"""Session service wrapping the ViMax SessionIndex for the web backend."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any, Optional

from agent_runtime.session_index import SessionIndex

from web.backend.models.api_models import SessionDetail, SessionListResponse, SessionSummary


class SessionService:
    """Thin service layer over SessionIndex.

    Translates between the low-level SessionIndex dicts and the Pydantic
    API models consumed by the FastAPI router layer.
    """

    def __init__(self, vi_max_root: str) -> None:
        self._index = SessionIndex(vi_max_root)

    # ── public read methods ────────────────────────────────────────────

    def list_sessions(
        self,
        search: str = "",
        stage: str = "",
        limit: int = 50,
        offset: int = 0,
    ) -> SessionListResponse:
        """Return a filtered, paginated list of session summaries."""
        data = self._index.load()
        all_sessions: dict[str, dict[str, Any]] = data.get("sessions", {})

        # Build a list of summaries, newest first
        summaries: list[SessionSummary] = []
        for session_id, raw in all_sessions.items():
            summary = self._to_summary(raw)
            # Filtering
            if search:
                q = search.lower()
                if q not in summary.idea.lower() and q not in summary.session_id.lower():
                    continue
            if stage and summary.stage != stage:
                continue
            summaries.append(summary)

        # Sort by updated_at descending (newest first)
        summaries.sort(key=lambda s: s.updated_at or "", reverse=True)

        total = len(summaries)
        page = summaries[offset : offset + limit]
        return SessionListResponse(items=page, total=total)

    def get_session(self, session_id: str) -> Optional[SessionDetail]:
        """Return full session detail, or None when not found."""
        raw = self._index.get(session_id)
        if raw is None:
            return None
        return self._to_detail(raw)

    # ── public mutators ────────────────────────────────────────────────

    def create_session(
        self,
        idea: str = "",
        user_requirement: str = "",
        style: str = "",
    ) -> SessionDetail:
        """Create a new session and return its detail view."""
        raw = self._index.create(
            idea=idea,
            user_requirement=user_requirement,
            style=style,
        )
        return self._to_detail(raw)

    def delete_session(self, session_id: str) -> dict[str, Any]:
        """Remove a session from the index and delete its working directory.

        Returns a status dict suitable for a JSON response:

            {"deleted": true, "session_id": "<id>"}
            {"error": "..."}  (caller maps to 404)
        """
        normalized = self._index._normalize_session_id(session_id)
        data = self._index.load()
        sessions: dict[str, Any] = data.get("sessions", {})

        if normalized not in sessions:
            return {"error": f"Session not found: {session_id}"}

        # Remove the working directory tree
        try:
            working_dir = self._index._working_dir_for_id(normalized)
            if working_dir.exists():
                shutil.rmtree(working_dir)
        except ValueError:
            # working_dir escaped .working_dir — still remove the record
            pass

        # Remove from sessions dict
        sessions.pop(normalized)

        # Clear active if it pointed to the deleted session
        if data.get("active_session_id") == normalized:
            data["active_session_id"] = ""

        self._index.save(data)
        return {"deleted": True, "session_id": normalized}

    # ── internal formatters ────────────────────────────────────────────

    def _to_summary(self, session_data: dict[str, Any]) -> SessionSummary:
        """Convert a raw session dict to a SessionSummary model."""
        checklist = self._index.artifact_checklist(session_data.get("session_id", ""))
        return SessionSummary(
            session_id=str(session_data.get("session_id", "")),
            idea=str(session_data.get("idea", "")),
            style=str(session_data.get("style", "")),
            stage=str(session_data.get("stage", "created")),
            summary=str(session_data.get("summary", "")),
            created_at=str(session_data.get("created_at", "")),
            updated_at=str(session_data.get("updated_at", "")),
            has_final_video=(
                checklist.get("idea2video/final_video.mp4", False)
                or checklist.get("script2video/final_video.mp4", False)
            ),
            thumbnail_url=None,
        )

    def _to_detail(self, session_data: dict[str, Any]) -> SessionDetail:
        """Convert a raw session dict to a SessionDetail model (includes checklist)."""
        sid = str(session_data.get("session_id", ""))
        checklist = self._index.artifact_checklist(sid)
        return SessionDetail(
            session_id=sid,
            idea=str(session_data.get("idea", "")),
            style=str(session_data.get("style", "")),
            stage=str(session_data.get("stage", "created")),
            summary=str(session_data.get("summary", "")),
            created_at=str(session_data.get("created_at", "")),
            updated_at=str(session_data.get("updated_at", "")),
            has_final_video=(
                checklist.get("idea2video/final_video.mp4", False)
                or checklist.get("script2video/final_video.mp4", False)
            ),
            thumbnail_url=None,
            user_requirement=str(session_data.get("user_requirement", "")),
            artifact_checklist=checklist,
            working_dir=str(session_data.get("working_dir", "")),
        )
