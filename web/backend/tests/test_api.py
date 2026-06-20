"""Integration tests for ViMax Web API endpoints.

Uses FastAPI TestClient — no server needed.
Run: cd /home/admin/ViMax && uv run python3 -m pytest web/backend/tests/ -v
"""

import pytest
from fastapi.testclient import TestClient

from web.backend.config import backend_config
from web.backend.main import app
from web.backend.services.session_service import SessionService
from web.backend.services.workspace_service import WorkspaceService


@pytest.fixture(autouse=True)
def _init_services(monkeypatch):
    """Inject services that the lifespan would normally create."""
    root = str(backend_config.vi_max_root)
    import web.backend.main as main_mod
    main_mod._session_service = SessionService(root)
    main_mod._workspace_service = WorkspaceService(root)
    main_mod._pipeline_service = None
    yield
    main_mod._session_service = None
    main_mod._pipeline_service = None
    main_mod._workspace_service = None


client = TestClient(app)


# ── Health ──────────────────────────────────────────────────────────────

def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


# ── Sessions CRUD ──────────────────────────────────────────────────────

class TestSessions:
    def test_create_session(self):
        r = client.post("/api/sessions", json={
            "idea": "test idea",
            "user_requirement": "test req",
            "style": "wuxia",
        })
        assert r.status_code == 201
        data = r.json()
        assert data["idea"] == "test idea"
        assert data["style"] == "wuxia"
        assert data["stage"] == "created"

    def test_list_sessions(self):
        r = client.get("/api/sessions")
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert "total" in data
        assert data["total"] >= 1

    def test_get_session_404(self):
        r = client.get("/api/sessions/nonexistent-session-id")
        assert r.status_code == 404

    def test_delete_session_404(self):
        r = client.delete("/api/sessions/nonexistent-session-id")
        assert r.status_code == 404

    def test_full_crud_cycle(self):
        # Create
        r = client.post("/api/sessions", json={
            "idea": "crud test", "user_requirement": "", "style": "modern",
        })
        assert r.status_code == 201
        sid = r.json()["session_id"]

        # Read
        r = client.get(f"/api/sessions/{sid}")
        assert r.status_code == 200
        assert r.json()["session_id"] == sid

        # Delete
        r = client.delete(f"/api/sessions/{sid}")
        assert r.status_code == 200
        assert r.json()["deleted"] is True

        # Verify deleted
        r = client.get(f"/api/sessions/{sid}")
        assert r.status_code == 404


# ── Pipeline ───────────────────────────────────────────────────────────

class TestPipeline:
    def test_plan_starts(self):
        r = client.post("/api/sessions", json={
            "idea": "pipeline test", "user_requirement": "", "style": "anime",
        })
        sid = r.json()["session_id"]

        # Start planning
        r = client.post("/api/pipeline/plan", json={
            "session_id": sid,
            "idea": "pipeline test",
            "user_requirement": "",
            "style": "anime",
        })
        assert r.status_code == 202
        assert r.json()["status"] == "started"
        assert r.json()["session_id"] == sid

    def test_cancel_nonexistent(self):
        r = client.post("/api/pipeline/cancel/nonexistent")
        assert r.status_code == 404


# ── Files & Security ───────────────────────────────────────────────────

class TestFiles:
    def test_file_not_found(self):
        r = client.get("/api/files/nonexistent/any/path.txt")
        assert r.status_code == 404

    def test_final_video_not_found(self):
        r = client.get("/api/files/nonexistent/final_video")
        assert r.status_code == 404

    def test_path_traversal_blocked(self):
        r = client.get("/api/files/test/../../../etc/passwd")
        assert r.status_code == 404  # resolve_path returns None

    def test_existing_artifact(self):
        # Create a session that has been planned
        r = client.post("/api/sessions", json={
            "idea": "file test", "user_requirement": "", "style": "suspense",
        })
        sid = r.json()["session_id"]

        # File shouldn't exist yet
        r = client.get(f"/api/files/{sid}/idea2video/story.txt")
        assert r.status_code == 404


# ── Styles ─────────────────────────────────────────────────────────────

def test_list_styles():
    r = client.get("/api/styles")
    assert r.status_code == 200
    data = r.json()
    assert len(data) >= 5
    assert any(s["key"] == "wuxia" for s in data)


# ── Works ──────────────────────────────────────────────────────────────

def test_list_works():
    r = client.get("/api/works")
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert "total" in data


def test_download_work_not_found():
    r = client.get("/api/works/nonexistent/download")
    assert r.status_code == 404


# ── Workspace Service ──────────────────────────────────────────────────

def test_count_shots_rendered_session():
    from web.backend.main import get_workspace_service
    svc = get_workspace_service()
    n = svc.count_shots("20260620-000041-vimax")
    assert n == 12

def test_count_shots_nonexistent():
    from web.backend.main import get_workspace_service
    svc = get_workspace_service()
    assert svc.count_shots("nonexistent") == 0
