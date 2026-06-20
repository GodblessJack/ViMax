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

    def list_orphaned_sessions(self, active_stages: set[str]) -> list[str]:
        """Return session IDs that are stuck in one of the given active stages.

        These are sessions whose pipeline task was killed by an unclean shutdown.
        """
        data = self._index.load()
        return [
            sid for sid, s in data.get("sessions", {}).items()
            if s.get("stage") in active_stages
        ]

    def mark_cancelled(self, session_id: str, summary: str = "Pipeline cancelled") -> None:
        """Mark a session's stage as 'cancelled' with the given summary.

        Silently ignores unknown session IDs — the session may have been
        deleted between the time it was discovered and cancellation.
        """
        try:
            self._index.update_stage(session_id, "cancelled", summary)
        except KeyError:
            pass

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

        # Hold the file lock only for the read-modify-write portion;
        # directory deletion (potentially slow) happens outside the lock.
        with self._index._locked():
            data = self._index.load()
            sessions: dict[str, Any] = data.get("sessions", {})

            if normalized not in sessions:
                return {"error": f"Session not found: {session_id}"}

            # Remove from sessions dict
            sessions.pop(normalized)

            # Clear active if it pointed to the deleted session
            if data.get("active_session_id") == normalized:
                data["active_session_id"] = ""

            self._index.save(data)

        # Remove the working directory tree (outside lock — can be slow)
        try:
            working_dir = self._index._working_dir_for_id(normalized)
            if working_dir.exists():
                shutil.rmtree(working_dir)
        except (ValueError, OSError):
            # working_dir escaped .working_dir, or directory couldn't be deleted
            pass

        return {"deleted": True, "session_id": normalized}

    # ── internal formatters ────────────────────────────────────────────

    def _has_final_video(self, session_id: str, checklist: dict[str, bool]) -> bool:
        """Check whether any final video exists (including scene_0 fallback)."""
        if checklist.get("idea2video/final_video.mp4", False):
            return True
        if checklist.get("script2video/final_video.mp4", False):
            return True
        # scene_0 fallback: pipeline may produce per-scene video without concatenation
        try:
            wd = self._index.working_dir(session_id)
            if (wd / "idea2video" / "scene_0" / "final_video.mp4").exists():
                return True
        except (KeyError, ValueError):
            pass
        return False

    def _to_summary(self, session_data: dict[str, Any]) -> SessionSummary:
        """Convert a raw session dict to a SessionSummary model."""
        checklist = self._index.artifact_checklist(session_data.get("session_id", ""))
        sid = str(session_data.get("session_id", ""))
        return SessionSummary(
            session_id=sid,
            idea=str(session_data.get("idea", "")),
            style=str(session_data.get("style", "")),
            stage=str(session_data.get("stage", "created")),
            summary=str(session_data.get("summary", "")),
            created_at=str(session_data.get("created_at", "")),
            updated_at=str(session_data.get("updated_at", "")),
            has_final_video=self._has_final_video(sid, checklist),
            thumbnail_url=None,
        )

    def _to_detail(self, session_data: dict[str, Any]) -> SessionDetail:
        """Convert a raw session dict to a SessionDetail model (includes checklist)."""
        sid = str(session_data.get("session_id", ""))
        checklist = self._index.artifact_checklist(sid)
        # Count shots from working directory
        shot_count = 0
        try:
            wd = self._index.working_dir(sid)
            for pipeline in ("idea2video", "script2video"):
                pipeline_dir = wd / pipeline
                if pipeline_dir.is_dir():
                    for scene_dir in pipeline_dir.glob("scene_*"):
                        if scene_dir.is_dir():
                            shot_count += len(list((scene_dir / "shots").glob("*/shot_description.json")))
        except (KeyError, ValueError):
            pass
        return SessionDetail(
            session_id=sid,
            idea=str(session_data.get("idea", "")),
            style=str(session_data.get("style", "")),
            stage=str(session_data.get("stage", "created")),
            summary=str(session_data.get("summary", "")),
            created_at=str(session_data.get("created_at", "")),
            updated_at=str(session_data.get("updated_at", "")),
            has_final_video=self._has_final_video(sid, checklist),
            thumbnail_url=None,
            user_requirement=str(session_data.get("user_requirement", "")),
            artifact_checklist=checklist,
            working_dir=str(session_data.get("working_dir", "")),
            shot_count=shot_count,
        )
