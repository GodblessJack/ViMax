"""Pydantic models for API request/response schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# ── Session ──────────────────────────────────────────────────────────

class SessionCreateRequest(BaseModel):
    idea: str = ""
    user_requirement: str = ""
    style: str = ""


class SessionSummary(BaseModel):
    session_id: str
    idea: str
    style: str
    stage: str
    summary: str = ""
    created_at: str = ""
    updated_at: str = ""
    has_final_video: bool = False
    thumbnail_url: Optional[str] = None


class SessionDetail(SessionSummary):
    user_requirement: str = ""
    artifact_checklist: dict[str, bool] = Field(default_factory=dict)
    working_dir: str = ""


class SessionListResponse(BaseModel):
    items: list[SessionSummary]
    total: int


# ── Pipeline ─────────────────────────────────────────────────────────

class PipelinePlanRequest(BaseModel):
    session_id: Optional[str] = None  # None = create new session
    idea: str = ""
    user_requirement: str = ""
    style: str = "Cinematic, 16:9"


class PipelineRenderRequest(BaseModel):
    session_id: str


class PipelineStartResponse(BaseModel):
    session_id: str
    status: str  # "started"


# ── Works ────────────────────────────────────────────────────────────

class WorkItem(BaseModel):
    session_id: str
    idea: str
    style: str
    created_at: str = ""
    updated_at: str = ""
    duration_seconds: Optional[float] = None
    shot_count: int = 0
    thumbnail_url: Optional[str] = None


class WorkListResponse(BaseModel):
    items: list[WorkItem]
    total: int


# ── Styles ───────────────────────────────────────────────────────────

class StylePreset(BaseModel):
    key: str
    name: str
    emoji: str
    description: str


# ── WebSocket events (typed dicts for documentation) ─────────────────

class WsPipelineEvent(BaseModel):
    type: str  # pipeline_status | artifact_ready | render_progress | pipeline_complete | pipeline_error
    session_id: str
    stage: Optional[str] = None
    phase: Optional[str] = None
    message: Optional[str] = None
    path: Optional[str] = None
    url: Optional[str] = None
    image_url: Optional[str] = None
    final_video_url: Optional[str] = None
    error: Optional[str] = None
    metadata: Optional[dict] = None
