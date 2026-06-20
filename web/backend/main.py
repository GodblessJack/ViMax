"""ViMax Web Backend — FastAPI application entry point.

Start with:
    cd /home/admin/ViMax
    uvicorn web.backend.main:app --reload --host 0.0.0.0 --port 8000
"""

# ── Logging — configure FIRST, before any module touch ─────────────────
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
LOG_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)-7s] %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        RotatingFileHandler(
            LOG_DIR / "vimax_web.log",
            maxBytes=10 * 1024 * 1024,   # 10 MB per file
            backupCount=10,               # keep 10 old files
            encoding="utf-8",
        ),
        logging.StreamHandler(),          # also print to terminal
    ],
)

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
_agent_service = None     # type: ignore — lazy-loaded AgentService


def get_session_service() -> SessionService:
    if _session_service is None:
        raise RuntimeError("SessionService not initialized")
    return _session_service


def get_pipeline_service():
    global _pipeline_service
    if _pipeline_service is None:
        from web.backend.services.pipeline_service import PipelineService
        _pipeline_service = PipelineService(str(backend_config.vi_max_root))
    return _pipeline_service


def get_workspace_service() -> WorkspaceService:
    if _workspace_service is None:
        raise RuntimeError("WorkspaceService not initialized")
    return _workspace_service


def get_agent_service():
    """Lazy-initialized AgentService singleton.

    AgentService wraps PipelineService with an Anthropic SDK Agent that
    manages the creative workflow through conversational interaction.
    """
    global _agent_service
    if _agent_service is None:
        from web.backend.services.agent_service import AgentService
        _agent_service = AgentService(pipeline_service=get_pipeline_service())
    return _agent_service


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
    _agent_service = None


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

# Rate limiter — 120 req/min per IP
from web.backend.middleware import RateLimiterMiddleware
app.add_middleware(RateLimiterMiddleware, max_requests=120, window_seconds=60)

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
