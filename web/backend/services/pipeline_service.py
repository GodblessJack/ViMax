"""Pipeline orchestration service.

Wraps ViMax pipeline classes (Idea2VideoPipeline, Script2VideoPipeline)
with WebSocket progress bridging, cancellation support, and concurrency management.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable

from agent_runtime.config import (
    llm_api_key, llm_base_url, llm_model, llm_model_provider,
    image_api_key, image_base_url, image_model,
    video_api_key, video_base_url, video_model,
)
from agent_runtime.session_index import SessionIndex
from langchain.chat_models import init_chat_model
from pipelines.idea2video_pipeline import Idea2VideoPipeline
from pipelines.script2video_pipeline import Script2VideoPipeline
from tools.image_generator_nanobanana_google_api import ImageGeneratorNanobananaGoogleAPI
from tools.image_generator_nanobanana_yunwu_api import ImageGeneratorNanobananaYunwuAPI
from tools.video_generator_omni_yunwu_api import VideoGeneratorOmniYunwuAPI
from tools.video_generator_veo_google_api import VideoGeneratorVeoGoogleAPI
from tools.video_generator_veo_yunwu_api import VideoGeneratorVeoYunwuAPI

from web.backend.models.api_models import (
    PipelinePlanRequest, PipelineRenderRequest, PipelineStartResponse,
)

logger = logging.getLogger(__name__)


# ── Dummy generator (reused from vimax_adapters pattern) ──────────────

class _UnavailableGenerator:
    """Placeholder generator that raises when called — used during planning
    so that no actual images/videos are created."""

    async def generate_single_image(self, *args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("Image generation is not available during planning")

    async def generate_single_video(self, *args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("Video generation is not available during planning")


# ── Output suppression (reused from vimax_adapters pattern) ───────────

class _DiscardStream:
    def write(self, data: str) -> None:
        pass
    def flush(self) -> None:
        pass


@contextmanager
def _suppress_pipeline_output():
    """Redirect stdout and mute noisy loggers during pipeline execution."""
    try:
        original_stdout = sys.stdout
        sys.stdout = _DiscardStream()
        # Silence known noisy loggers — save/restore original levels
        _muted = ["pipelines", "agents", "tools", "httpx", "openai", "httpcore", ""]
        _saved = {}
        for name in _muted:
            logger = logging.getLogger(name) if name else logging.getLogger()
            _saved[name] = logger.level
            logger.setLevel(logging.WARNING)
        yield
    finally:
        sys.stdout = original_stdout
        for name, level in _saved.items():
            logger = logging.getLogger(name) if name else logging.getLogger()
            logger.setLevel(level)


# ── Pipeline service ─────────────────────────────────────────────────

class PipelineService:
    """Orchestrates ViMax pipeline execution with WebSocket progress bridging.

    Each pipeline run is an asyncio.Task tracked per session_id.
    Multiple sessions can run concurrently (different working dirs).
    """

    def __init__(self, vi_max_root: str) -> None:
        self._root = Path(vi_max_root)
        self._session_index = SessionIndex(vi_max_root)
        self._tasks: dict[str, asyncio.Task] = {}
        self._cancel_events: dict[str, asyncio.Event] = {}
        self._ws_connections: dict[str, list] = {}  # session_id -> list of WebSocket

    # ── WebSocket connection registry ─────────────────────────────────

    def register_ws(self, session_id: str, websocket) -> None:
        self._ws_connections.setdefault(session_id, []).append(websocket)

    def unregister_ws(self, session_id: str, websocket) -> None:
        conns = self._ws_connections.get(session_id, [])
        if websocket in conns:
            conns.remove(websocket)

    async def _broadcast_ws(self, session_id: str, payload: dict) -> None:
        conns = list(self._ws_connections.get(session_id, []))
        dead = []
        for ws in conns:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.unregister_ws(session_id, ws)

    # ── Progress callback factory ─────────────────────────────────────

    def _ws_progress_callback(self, session_id: str) -> Callable:
        """Return a sync-compatible progress callback that schedules WS broadcasts.

        The pipeline code calls progress() synchronously (without await), so we
        must return a regular function — not a coroutine.  We use
        asyncio.get_running_loop() + create_task() to fire-and-forget the
        broadcast so the pipeline never blocks on WebSocket I/O.
        """
        def emit(stage: str, message: str, metadata: dict[str, Any] | None = None) -> None:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                return  # no event loop — should never happen inside _run_planning / _run_rendering
            task = loop.create_task(
                self._broadcast_ws(session_id, {
                    "type": "pipeline_status",
                    "session_id": session_id,
                    "stage": stage,
                    "message": message,
                    "metadata": metadata or {},
                })
            )
            # Log any exception from the broadcast task so it isn't silently swallowed
            def _log_task_error(t: asyncio.Task) -> None:
                if not t.cancelled():
                    exc = t.exception()
                    if exc is not None:
                        logger.warning("WS broadcast failed for session %s: %s", session_id, exc)
            task.add_done_callback(_log_task_error)
        return emit

    # ── Pipeline builders ─────────────────────────────────────────────

    def _build_chat_model(self):
        root = str(self._root)
        api_key = llm_api_key(root)
        model = llm_model(root)
        provider = llm_model_provider(root)
        base = llm_base_url(root)

        # DashScope fallback: use DASHSCOPE_API_KEY when primary key is missing
        ds_key = os.environ.get("DASHSCOPE_API_KEY", "")
        if ds_key and not api_key:
            api_key = ds_key
            base = "https://dashscope.aliyuncs.com/compatible-mode/v1"
            model = "qwen-plus"  # DashScope-compatible model (not google/*)
            provider = "openai"

        return init_chat_model(
            model=model,
            model_provider=provider,
            api_key=api_key,
            base_url=base,
            timeout=300,
            max_retries=0,
            max_completion_tokens=4096,
        )

    def _build_image_generator(self):
        import os
        root = str(self._root)
        api_key = image_api_key(root)
        model_name = image_model(root)
        base = image_base_url(root)

        # DashScope: detected when DASHSCOPE_API_KEY is set and base_url contains dashscope
        ds_key = os.environ.get("DASHSCOPE_API_KEY", "")
        if ds_key and (not api_key or "dashscope" in str(base or "").lower()):
            from tools.image_generator_dashscope import ImageGeneratorDashScope
            return ImageGeneratorDashScope(
                api_key=ds_key,
                model="wanx2.1-t2i-turbo",
            )

        # Yunwu proxy
        if base and "yunwu.ai" in base:
            return ImageGeneratorNanobananaYunwuAPI(
                api_key=api_key, model=model_name, base_url=base,
            )
        # Default: Google
        return ImageGeneratorNanobananaGoogleAPI(api_key=api_key, model=model_name)

    def _build_video_generator(self):
        import os
        root = str(self._root)
        api_key = video_api_key(root)
        model_name = video_model(root)
        base = video_base_url(root)

        # DashScope fallback
        ds_key = os.environ.get("DASHSCOPE_API_KEY", "")
        if ds_key and (not api_key or "dashscope" in str(base or "").lower()):
            from tools.video_generator_dashscope import VideoGeneratorDashScope
            return VideoGeneratorDashScope(
                api_key=ds_key,
                t2v_model="wan2.5-t2v-preview",
            )

        # Yunwu proxy
        if base and "yunwu.ai" in base:
            return VideoGeneratorVeoYunwuAPI(
                api_key=api_key, t2v_model=model_name,
                ff2v_model=model_name, base_url=base,
            )
        # OpenRouter
        if base and "openrouter.ai" in base:
            from tools.video_generator_openrouter_api import VideoGeneratorOpenRouterAPI
            return VideoGeneratorOpenRouterAPI(
                api_key=api_key, model=model_name, base_url=base,
            )
        # Default: Google Veo
        return VideoGeneratorVeoGoogleAPI(api_key=api_key)

    # ── Public API: start planning ────────────────────────────────────

    async def start_planning(
        self,
        request: PipelinePlanRequest,
    ) -> PipelineStartResponse:
        session_id = request.session_id
        if not session_id:
            raw = self._session_index.create(
                idea=request.idea,
                user_requirement=request.user_requirement,
                style=request.style,
            )
            session_id = raw.get("session_id", "")
        else:
            self._session_index.set_active(session_id)

        if session_id in self._tasks and not self._tasks[session_id].done():
            raise ValueError(f"Pipeline already running for session {session_id}")

        cancel_evt = asyncio.Event()
        self._cancel_events[session_id] = cancel_evt
        task = asyncio.create_task(
            self._run_planning(session_id, request, cancel_evt),
            name=f"plan-{session_id}",
        )
        self._tasks[session_id] = task
        task.add_done_callback(lambda _t: self._cleanup(session_id))
        return PipelineStartResponse(session_id=session_id, status="started")

    async def _run_planning(
        self,
        session_id: str,
        request: PipelinePlanRequest,
        cancel_evt: asyncio.Event,
    ) -> None:
        """Execute the full planning pipeline: story → characters → script → storyboard."""
        try:
            self._session_index.update_stage(session_id, "narrative_planning", "Planning started")

            chat_model = self._build_chat_model()
            dummy = _UnavailableGenerator()
            working_dir = str(self._session_index.working_dir(session_id) / "idea2video")
            os.makedirs(working_dir, exist_ok=True)

            pipeline = Idea2VideoPipeline(
                chat_model=chat_model,
                image_generator=dummy,
                video_generator=dummy,
                working_dir=working_dir,
            )

            # Step 1: Develop story
            if cancel_evt.is_set():
                return
            await self._broadcast_ws(session_id, {
                "type": "pipeline_status", "session_id": session_id,
                "stage": "develop_story", "phase": "started",
                "message": "Developing story from idea...",
            })
            with _suppress_pipeline_output():
                story = await pipeline.develop_story(
                    idea=request.idea,
                    user_requirement=request.user_requirement,
                    quiet=True,
                )
            await self._broadcast_ws(session_id, {
                "type": "artifact_ready", "session_id": session_id,
                "path": "idea2video/story.txt",
                "url": f"/api/files/{session_id}/idea2video/story.txt",
            })

            # Step 2: Extract characters
            if cancel_evt.is_set():
                return
            await self._broadcast_ws(session_id, {
                "type": "pipeline_status", "session_id": session_id,
                "stage": "extract_characters", "phase": "started",
            })
            with _suppress_pipeline_output():
                characters = await pipeline.extract_characters(story=story, quiet=True)
            await self._broadcast_ws(session_id, {
                "type": "artifact_ready", "session_id": session_id,
                "path": "idea2video/characters.json",
                "url": f"/api/files/{session_id}/idea2video/characters.json",
            })

            # Step 3: Write script
            if cancel_evt.is_set():
                return
            await self._broadcast_ws(session_id, {
                "type": "pipeline_status", "session_id": session_id,
                "stage": "write_script", "phase": "started",
            })
            with _suppress_pipeline_output():
                scene_scripts = await pipeline.write_script_based_on_story(
                    story=story,
                    user_requirement=request.user_requirement,
                    quiet=True,
                )
            await self._broadcast_ws(session_id, {
                "type": "artifact_ready", "session_id": session_id,
                "path": "idea2video/script.json",
                "url": f"/api/files/{session_id}/idea2video/script.json",
            })

            # Step 4: Plan text artifacts per scene
            for idx, scene_script in enumerate(scene_scripts):
                if cancel_evt.is_set():
                    return
                scene_dir = os.path.join(working_dir, f"scene_{idx}")
                os.makedirs(scene_dir, exist_ok=True)

                if isinstance(scene_script, dict):
                    script_text = json.dumps(scene_script)
                else:
                    script_text = str(scene_script)

                sp = Script2VideoPipeline(
                    chat_model=chat_model,
                    image_generator=dummy,
                    video_generator=dummy,
                    working_dir=scene_dir,
                )
                await self._broadcast_ws(session_id, {
                    "type": "pipeline_status", "session_id": session_id,
                    "stage": f"plan_scene_{idx}", "phase": "started",
                    "message": f"Planning scene {idx + 1}/{len(scene_scripts)}...",
                })
                with _suppress_pipeline_output():
                    await sp.plan_text_artifacts(
                        script=script_text,
                        user_requirement=request.user_requirement,
                        style=request.style,
                        characters=characters,
                        progress=self._ws_progress_callback(session_id),
                        quiet=True,
                    )
                await self._broadcast_ws(session_id, {
                    "type": "artifact_ready", "session_id": session_id,
                    "path": f"idea2video/scene_{idx}/storyboard.json",
                    "url": f"/api/files/{session_id}/idea2video/scene_{idx}/storyboard.json",
                })

            self._session_index.update_stage(session_id, "narrative_planned", "Planning complete")
            await self._broadcast_ws(session_id, {
                "type": "pipeline_complete", "session_id": session_id,
                "stage": "narrative_planned",
                "message": "Planning complete. Ready for rendering.",
            })

        except asyncio.CancelledError:
            self._session_index.update_stage(session_id, "cancelled", "Planning cancelled")
            await self._broadcast_ws(session_id, {
                "type": "pipeline_error", "session_id": session_id,
                "error": "Planning was cancelled",
            })
        except Exception as exc:
            logger.exception("Planning failed for session %s", session_id)
            friendly = f"规划失败: {str(exc)[:200]}"
            self._session_index.update_stage(session_id, "error", friendly)
            await self._broadcast_ws(session_id, {
                "type": "pipeline_error", "session_id": session_id,
                "error": friendly,
            })

    # ── Public API: start rendering ───────────────────────────────────

    async def start_rendering(
        self,
        request: PipelineRenderRequest,
    ) -> PipelineStartResponse:
        session_id = request.session_id

        if session_id in self._tasks and not self._tasks[session_id].done():
            raise ValueError(f"Pipeline already running for session {session_id}")

        cancel_evt = asyncio.Event()
        self._cancel_events[session_id] = cancel_evt
        task = asyncio.create_task(
            self._run_rendering(session_id, cancel_evt),
            name=f"render-{session_id}",
        )
        self._tasks[session_id] = task
        task.add_done_callback(lambda _t: self._cleanup(session_id))
        return PipelineStartResponse(session_id=session_id, status="started")

    async def _run_rendering(
        self,
        session_id: str,
        cancel_evt: asyncio.Event,
    ) -> None:
        """Execute full rendering: character portraits → frames → video."""
        try:
            self._session_index.update_stage(session_id, "rendering", "Rendering started")

            chat_model = self._build_chat_model()
            image_gen = self._build_image_generator()
            video_gen = self._build_video_generator()
            working_dir = str(self._session_index.working_dir(session_id) / "idea2video")

            pipeline = Idea2VideoPipeline(
                chat_model=chat_model,
                image_generator=image_gen,
                video_generator=video_gen,
                working_dir=working_dir,
            )

            # Load characters
            chars_path = os.path.join(working_dir, "characters.json")
            if not os.path.exists(chars_path):
                raise FileNotFoundError(f"characters.json not found — run planning first")
            with open(chars_path, "r") as f:
                characters_data = json.load(f)

            from interfaces.character import CharacterInScene
            characters = [CharacterInScene.model_validate(c) for c in characters_data]

            if cancel_evt.is_set():
                return

            # Generate character portraits
            await self._broadcast_ws(session_id, {
                "type": "pipeline_status", "session_id": session_id,
                "stage": "character_portraits", "phase": "started",
                "message": f"Generating portraits for {len(characters)} characters...",
            })
            session = self._session_index.get(session_id)
            style_val = (session or {}).get("style", "")
            with _suppress_pipeline_output():
                await pipeline.generate_character_portraits(
                    characters=characters,
                    character_portraits_registry=None,
                    style=style_val,
                )
            for c in characters:
                for view in ["front", "side", "back"]:
                    img_path = os.path.join(
                        working_dir, "character_portraits",
                        f"{c.idx}_{c.identifier_in_scene or 'unknown'}",
                        f"{view}.png",
                    )
                    if os.path.exists(img_path):
                        await self._broadcast_ws(session_id, {
                            "type": "render_progress",
                            "session_id": session_id,
                            "stage": "character_portrait", "phase": "done",
                            "character": c.identifier_in_scene,
                            "view": view,
                            "image_url": f"/api/files/{session_id}/idea2video/character_portraits/{c.idx}_{c.identifier_in_scene or 'unknown'}/{view}.png",
                        })

            if cancel_evt.is_set():
                return

            # Load scene scripts
            script_path = os.path.join(working_dir, "script.json")
            if not os.path.exists(script_path):
                raise FileNotFoundError(f"script.json not found — run planning first")
            with open(script_path, "r") as f:
                scene_scripts = json.load(f)

            # Render each scene
            for idx, scene_script in enumerate(scene_scripts):
                if cancel_evt.is_set():
                    return
                scene_dir = os.path.join(working_dir, f"scene_{idx}")
                os.makedirs(scene_dir, exist_ok=True)

                script_text = json.dumps(scene_script) if isinstance(scene_script, dict) else str(scene_script)

                sp = Script2VideoPipeline(
                    chat_model=chat_model,
                    image_generator=image_gen,
                    video_generator=video_gen,
                    working_dir=scene_dir,
                )
                await self._broadcast_ws(session_id, {
                    "type": "pipeline_status", "session_id": session_id,
                    "stage": f"render_scene_{idx}", "phase": "started",
                    "message": f"Rendering scene {idx + 1}/{len(scene_scripts)}...",
                })
                with _suppress_pipeline_output():
                    session_data = self._session_index.get(session_id) or {}
                    await sp(
                        script=script_text,
                        user_requirement=session_data.get("user_requirement", ""),
                        style=session_data.get("style", ""),
                        characters=characters,
                        progress=self._ws_progress_callback(session_id),
                        quiet=True,
                    )

            # Final video exists check
            final_path = os.path.join(working_dir, "final_video.mp4")
            if os.path.exists(final_path):
                self._session_index.update_stage(session_id, "rendered", "Rendering complete")
                await self._broadcast_ws(session_id, {
                    "type": "pipeline_complete", "session_id": session_id,
                    "stage": "rendered",
                    "final_video_url": f"/api/files/{session_id}/idea2video/final_video.mp4",
                })
            else:
                self._session_index.update_stage(session_id, "rendered", "Rendering complete (no concat)")
                # Try scene 0 video
                scene0_video = os.path.join(working_dir, "scene_0", "final_video.mp4")
                if os.path.exists(scene0_video):
                    await self._broadcast_ws(session_id, {
                        "type": "pipeline_complete", "session_id": session_id,
                        "stage": "rendered",
                        "final_video_url": f"/api/files/{session_id}/idea2video/scene_0/final_video.mp4",
                    })

        except asyncio.CancelledError:
            self._session_index.update_stage(session_id, "cancelled", "Rendering cancelled")
            await self._broadcast_ws(session_id, {
                "type": "pipeline_error", "session_id": session_id,
                "error": "Rendering was cancelled",
            })
        except Exception as exc:
            logger.exception("Rendering failed for session %s", session_id)
            friendly = f"渲染失败: {str(exc)[:200]}"
            self._session_index.update_stage(session_id, "error", friendly)
            await self._broadcast_ws(session_id, {
                "type": "pipeline_error", "session_id": session_id,
                "error": friendly,
            })

    # ── Public API: cancel ────────────────────────────────────────────

    def running_session_ids(self) -> list[str]:
        """Return session IDs that currently have an active pipeline task."""
        return [sid for sid, t in self._tasks.items() if not t.done()]

    async def cancel_all(self, timeout: float = 2.0) -> list[str]:
        """Cancel all running pipeline tasks and wait for them to finish.

        Returns the list of session IDs that were cancelled.
        Tasks that fail to cancel within *timeout* seconds are logged and abandoned.
        """
        cancelled: list[str] = []
        for sid, task in list(self._tasks.items()):
            if not task.done():
                task.cancel()
                cancelled.append(sid)

        if cancelled:
            pending = [self._tasks[sid] for sid in cancelled if not self._tasks[sid].done()]
            if pending:
                done, still_pending = await asyncio.wait(pending, timeout=timeout)
                if still_pending:
                    logger.warning(
                        "%d pipeline tasks did not cancel within %.0fs (abandoned): %s",
                        len(still_pending), timeout,
                        [t.get_name() for t in still_pending],
                    )

        return cancelled

    async def cancel_pipeline(self, session_id: str) -> dict:
        if session_id not in self._cancel_events:
            return {"cancelled": False, "error": f"No pipeline running for session {session_id}"}
        self._cancel_events[session_id].set()
        return {"cancelled": True, "session_id": session_id}

    # ── Cleanup ───────────────────────────────────────────────────────

    def _cleanup(self, session_id: str) -> None:
        self._tasks.pop(session_id, None)
        self._cancel_events.pop(session_id, None)
