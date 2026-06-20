"""ViMax Web Backend — FastAPI application entry point.

Start with:
    cd /home/admin/ViMax
    uvicorn web.backend.main:app --reload --host 0.0.0.0 --port 8000
"""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from web.backend.config import backend_config
from web.backend.services.session_service import SessionService
from web.backend.services.workspace_service import WorkspaceService
# PipelineService is lazy-loaded (heavy LangChain imports)

# ── Singletons — initialized at startup ──────────────────────────────

_session_service: SessionService | None = None
_pipeline_service = None  # type: ignore — lazy-loaded PipelineService
_workspace_service: WorkspaceService | None = None


def get_session_service() -> SessionService:
    assert _session_service is not None, "SessionService not initialized"
    return _session_service


def get_pipeline_service():
    global _pipeline_service
    if _pipeline_service is None:
        from web.backend.services.pipeline_service import PipelineService
        _pipeline_service = PipelineService(str(backend_config.vi_max_root))
    return _pipeline_service


def get_workspace_service() -> WorkspaceService:
    assert _workspace_service is not None, "WorkspaceService not initialized"
    return _workspace_service


# ── Lifespan ─────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _session_service, _pipeline_service, _workspace_service
    root = str(backend_config.vi_max_root)
    _session_service = SessionService(root)
    _workspace_service = WorkspaceService(root)
    _pipeline_service = None
    # ── Startup recovery: mark orphaned active sessions as cancelled ──
    import logging
    _logger = logging.getLogger(__name__)
    for sid in _session_service.list_orphaned_sessions({"narrative_planning", "rendering"}):
        try:
            _session_service.mark_cancelled(sid, "Server restart — previous run was interrupted")
            _logger.info("Startup recovery: marked orphaned session %s as cancelled", sid)
        except Exception:
            _logger.warning("Startup recovery: failed to cancel session %s", sid)
    yield
    # ── Shutdown: cancel running pipelines via public API ───────────
    if _pipeline_service is not None and _session_service is not None:
        import logging
        logger = logging.getLogger(__name__)
        for sid in await _pipeline_service.cancel_all():
            try:
                _session_service.mark_cancelled(sid, "Server shutdown")
            except Exception:
                logger.warning("Failed to mark session %s as cancelled", sid)
    _session_service = None
    _pipeline_service = None
    _workspace_service = None


# ── App ──────────────────────────────────────────────────────────────

app = FastAPI(
    title="ViMax Web API",
    description="AI short drama generation platform — management interface API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=backend_config.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ──────────────────────────────────────────────────────────

from web.backend.routers import sessions, pipeline, works, files, styles, ws, chat

app.include_router(sessions.router)
app.include_router(pipeline.router)
app.include_router(works.router)
app.include_router(files.router)
app.include_router(styles.router)
app.include_router(ws.router)
app.include_router(chat.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "vimax-web-backend"}
