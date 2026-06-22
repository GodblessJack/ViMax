"""Pipeline Tools for the Agent -- plain async functions with docstrings and type hints.

Each tool is a callable that the AgentService registers with the LLM.
Tools wrap PipelineService PUBLIC methods and add confirmation-gate integration.

V3 refactor: tool_run_step delegates to tool_request_step_execution.
All tools call PipelineService PUBLIC methods only (Loop Engineer rule #4).
"""

from __future__ import annotations

import difflib
import json
import logging
import os
from pathlib import Path
from typing import Any, Callable

from web.backend.services.confirmation_gate import ConfirmationGate

logger = logging.getLogger(__name__)


# ── WS broadcaster factory ────────────────────────────────────────────────

def _ws_broadcaster_factory(agent_service: Any, session_id: str) -> Callable:
    """Return a progress callback that sends pipeline_status events to WS clients
    via AgentService's broadcast method."""
    def _emit(stage: str, message: str, metadata: dict[str, Any] | None = None) -> None:
        import asyncio
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(
            agent_service.broadcast(session_id, {
                "type": "pipeline_status",
                "session_id": session_id,
                "stage": stage,
                "phase": "progress",
                "message": message,
                "metadata": metadata or {},
            })
        )
    return _emit


# ── Shared helpers ────────────────────────────────────────────────────────

def _read_story_preview(session_id: str, svc: Any) -> dict[str, Any] | None:
    """Read story.txt and return a preview snippet for the step:completed event."""
    try:
        wd = svc._index.working_dir(session_id)
        story_path = wd / "idea2video" / "story.txt"
        if not story_path.exists():
            return None
        text = story_path.read_text(encoding="utf-8")
        preview = text[:200]
        for sep in ["\n\n", "\n", "。", "；"]:
            idx = preview.rfind(sep)
            if idx > 50:
                preview = preview[:idx + len(sep)]
                break
        return {
            "storyPreview": preview.strip(),
            "totalChars": len(text),
            "paragraphCount": text.count("\n\n") + 1,
        }
    except Exception:
        return None


def _read_characters_preview(session_id: str, svc: Any) -> dict[str, Any] | None:
    """Read characters.json and return summary data."""
    try:
        wd = svc._index.working_dir(session_id)
        chars_path = wd / "idea2video" / "characters.json"
        if not chars_path.exists():
            return None
        chars_data = json.loads(chars_path.read_text(encoding="utf-8"))
        if isinstance(chars_data, list):
            names = [c.get("name", "?") for c in chars_data]
            return {"characterNames": names, "count": len(names)}
        return {"characterNames": [], "count": 0}
    except Exception:
        return None


def _read_script_preview(session_id: str, svc: Any) -> dict[str, Any] | None:
    """Read script.json and return summary data."""
    try:
        wd = svc._index.working_dir(session_id)
        script_path = wd / "idea2video" / "script.json"
        if not script_path.exists():
            return None
        script_data = json.loads(script_path.read_text(encoding="utf-8"))
        if isinstance(script_data, list):
            titles = [
                s.get("title", f"Scene {s.get('scene_number', '?')}")
                for s in script_data
            ]
            return {"sceneTitles": titles, "sceneCount": len(titles)}
        return {"sceneTitles": [], "sceneCount": 0}
    except Exception:
        return None


def _read_storyboard_preview(session_id: str, svc: Any) -> dict[str, Any] | None:
    """Read all scene storyboards and return structured preview."""
    try:
        wd = svc._index.working_dir(session_id)
        i2v_dir = wd / "idea2video"
        storyboards = []
        for sc_p in sorted(i2v_dir.glob("scene_*/storyboard.json")):
            try:
                sc_data = json.loads(sc_p.read_text(encoding="utf-8"))
                scene_idx = int(sc_p.parent.name.split("_")[-1]) if "_" in sc_p.parent.name else 0
                shots = []
                if isinstance(sc_data, list):
                    for j, s in enumerate(sc_data):
                        shots.append({
                            "idx": j + 1,
                            "visual_desc": s.get("visual_description", "")[:120],
                            "angle": s.get("camera_angle", s.get("angle", "中景")),
                        })
                storyboards.append({
                    "index": scene_idx,
                    "title": f"场景 {scene_idx + 1}",
                    "shots": shots,
                })
            except Exception:
                pass
        return storyboards
    except Exception:
        return None


def _read_portraits_preview(session_id: str, svc: Any) -> dict[str, Any] | None:
    """Read character portraits and return structured preview."""
    try:
        wd = svc._index.working_dir(session_id)
        i2v_dir = wd / "idea2video"
        portraits_dir = i2v_dir / "character_portraits"
        portraits = []
        if portraits_dir.exists():
            for char_dir in sorted(portraits_dir.iterdir()):
                if char_dir.is_dir():
                    views = {}
                    for img in sorted(char_dir.glob("*.png")):
                        views[img.stem] = str(img.relative_to(i2v_dir))
                    if views:
                        parts = char_dir.name.split("_", 1)
                        portraits.append({
                            "character_name": parts[1] if len(parts) > 1 else char_dir.name,
                            "character_id": parts[0] if len(parts) > 0 else "",
                            "views": views,
                        })
        return {"portraits": portraits} if portraits else None
    except Exception:
        return None


def _check_final_video(session_id: str, svc: Any) -> dict[str, Any] | None:
    """Check if final video exists and return URL info."""
    try:
        wd = svc._index.working_dir(session_id)
        video_path = wd / "idea2video" / "final_video.mp4"
        if video_path.exists():
            return {"finalVideoUrl": f"/api/files/{session_id}/final_video"}
        return None
    except Exception:
        return None


def _resolve_artifact_file(session_id: str, artifact_path: str, for_write: bool = False):
    """Resolve and validate an artifact file path within the session working dir.

    Returns (working_dir, resolved_path) or raises ValueError/FileNotFoundError.
    """
    from web.backend.main import get_session_service
    svc = get_session_service()
    session = svc._index.get(session_id)
    if session is None:
        raise ValueError(f"Session not found: {session_id}")

    wd = svc._index.working_dir(session_id)
    target = (wd / artifact_path).resolve()
    wd_resolved = wd.resolve()

    # Containment check: prevent path traversal
    if wd_resolved not in target.parents and target != wd_resolved:
        raise ValueError(f"Path traversal blocked: {artifact_path}")

    if not for_write and not target.exists():
        raise FileNotFoundError(f"Artifact not found: {artifact_path}")

    return wd, target


async def _poll_pipeline_completion(psvc: Any, session_id: str, timeout: float = 300.0) -> str:
    """Wait for a pipeline task to reach a terminal stage using public APIs.

    Returns the final session stage string.
    """
    import asyncio
    from web.backend.main import get_session_service

    terminal_stages = {"narrative_planned", "rendered", "error", "cancelled"}
    start = asyncio.get_event_loop().time()
    while True:
        svc = get_session_service()
        session = svc.get_session(session_id)
        if session is None:
            return "unknown"
        stage = getattr(session, "stage", "")
        if stage in terminal_stages:
            return stage
        elapsed = asyncio.get_event_loop().time() - start
        if elapsed > timeout:
            return "timeout"
        await asyncio.sleep(1.0)


# ═══════════════════════════════════════════════════════════════════════════
# Tool 1: create_story
# ═══════════════════════════════════════════════════════════════════════════

async def tool_create_story(
    session_id: str,
    idea: str,
    style: str = "wuxia",
    user_requirement: str = "",
    agent_service: Any = None,
) -> dict[str, Any]:
    """Create/generate the story text from an idea.  This is Step 1 of the pipeline.

    Calls PipelineService.start_planning() (PUBLIC method) which runs story
    generation and all dependent planning steps.  The tool waits for the planning
    pipeline to reach a terminal stage, then broadcasts step:completed.

    Args:
        session_id: The session identifier.
        idea: The creative idea for the story.
        style: Visual/style keyword (e.g. "wuxia", "comedy", "suspense").
        user_requirement: Additional user requirements or constraints.
        agent_service: The AgentService instance for WS broadcast.

    Returns:
        Dict with "status": "ok" | "error" and result metadata.
    """
    if agent_service is None:
        return {"status": "error", "error": "agent_service is required"}
    psvc = agent_service._pipeline_service
    if psvc is None:
        return {"status": "error", "error": "PipelineService not available"}

    from web.backend.models.api_models import PipelinePlanRequest
    from web.backend.main import get_session_service

    try:
        # ── Broadcast pre-execution context ──────────────────────────────
        await agent_service.broadcast(session_id, {
            "type": "step:preparing",
            "step": "story_generation",
            "context": {
                "inputs": {"idea": idea, "style": style, "user_requirement": user_requirement},
                "constraints": [],
                "agentIntent": "Creating story from idea",
            },
        })

        await agent_service.broadcast(session_id, {
            "type": "step:running",
            "step": "story_generation",
            "progress_percent": 0,
            "progress_message": "正在构思故事...",
        })

        # ── Call PUBLIC PipelineService method ───────────────────────────
        request = PipelinePlanRequest(
            session_id=session_id,
            idea=idea,
            style=style,
            user_requirement=user_requirement,
        )
        await psvc.start_planning(request)

        # Wait for planning pipeline to finish
        final_stage = await _poll_pipeline_completion(psvc, session_id)
        if final_stage in ("error", "cancelled", "timeout"):
            svc = get_session_service()
            session = svc.get_session(session_id)
            error_msg = getattr(session, "error_message", "") if session else ""
            raise RuntimeError(error_msg or f"Planning failed, stage: {final_stage}")

        # ── Broadcast step:completed ─────────────────────────────────────
        svc = get_session_service()
        preview = _read_story_preview(session_id, svc)
        await agent_service.broadcast(session_id, {
            "type": "step:completed",
            "step": "story_generation",
            "result": {
                "summary": "故事构思完成",
                "artifactPaths": ["idea2video/story.txt"],
                "previewData": preview,
                "editableFields": [],
            },
        })
        return {"status": "ok", "step": "story_generation", "artifacts": ["idea2video/story.txt"]}

    except Exception as exc:
        logger.exception("create_story failed for session %s", session_id)
        await agent_service.broadcast(session_id, {
            "type": "step:error",
            "step": "story_generation",
            "error": str(exc),
            "recoverable": True,
        })
        return {"status": "error", "error": str(exc)}


# ═══════════════════════════════════════════════════════════════════════════
# Tool 2: inspect_pipeline
# ═══════════════════════════════════════════════════════════════════════════

async def tool_inspect_pipeline(
    session_id: str,
    step_name: str = "",
    include_sub_steps: bool = True,
    include_artifacts: bool = True,
    include_timings: bool = False,
    agent_service: Any = None,
) -> dict[str, Any]:
    """Inspect the detailed state of the pipeline.

    Uses only PUBLIC APIs (get_session_service, file system via session service).
    Returns per-step progress, sub-step status, artifact inventory.

    Args:
        session_id: The session identifier.
        step_name: Optional specific step to inspect. Empty = all steps.
        include_sub_steps: Include sub-step details (default true).
        include_artifacts: Include artifact file inventory (default true).
        include_timings: Include timing data (default false).
        agent_service: The AgentService instance.

    Returns:
        Dict with pipeline inspection results.
    """
    from web.backend.main import get_session_service

    try:
        svc = get_session_service()
        session = svc.get_session(session_id)
        if session is None:
            return {"error": f"Session not found: {session_id}"}

        stage = getattr(session, "stage", "unknown")
        result: dict[str, Any] = {
            "session_id": session_id,
            "stage": stage,
            "idea": getattr(session, "idea", ""),
            "style": getattr(session, "style", ""),
        }

        # ── Step progress ────────────────────────────────────────────────
        all_steps = [
            "story_generation", "character_extraction", "script_writing",
            "storyboard_design", "character_portraits", "video_rendering",
        ]
        completed_steps = []
        current_step = None

        if stage == "narrative_planning":
            current_step = "story_generation"
        elif stage == "narrative_planned":
            completed_steps = all_steps[:4]
            current_step = "character_portraits"
        elif stage == "rendering":
            completed_steps = all_steps[:4]
            current_step = "character_portraits"
        elif stage == "rendered":
            completed_steps = list(all_steps)

        total = len(all_steps)
        done = len(completed_steps)
        result["pipeline_progress"] = {
            "completedSteps": completed_steps,
            "currentStep": current_step,
            "totalSteps": total,
            "completionPercent": round(done / total * 100, 1) if total > 0 else 0,
        }

        # ── Filter to requested step ─────────────────────────────────────
        request_steps = [step_name] if step_name else all_steps

        # ── Artifacts ────────────────────────────────────────────────────
        if include_artifacts:
            wd = svc._index.working_dir(session_id)
            i2v_dir = wd / "idea2video"
            available: dict[str, dict[str, Any]] = {}
            artifact_map = {
                "story_generation": ["story.txt"],
                "character_extraction": ["characters.json"],
                "script_writing": ["script.json"],
                "storyboard_design": [],  # dynamic scene dirs
                "character_portraits": [],  # dynamic portrait dirs
                "video_rendering": ["final_video.mp4"],
            }
            for s in request_steps:
                files = artifact_map.get(s, [])
                step_artifacts: dict[str, dict[str, Any]] = {}
                for f in files:
                    fp = i2v_dir / f
                    step_artifacts[f] = {
                        "exists": fp.exists(),
                        "size": fp.stat().st_size if fp.exists() else None,
                    }
                # storyboard scenes
                if s == "storyboard_design":
                    for sc_p in sorted(i2v_dir.glob("scene_*/storyboard.json")):
                        key = str(sc_p.relative_to(i2v_dir))
                        step_artifacts[key] = {
                            "exists": True,
                            "size": sc_p.stat().st_size,
                        }
                # character portraits
                if s == "character_portraits":
                    portraits_dir = i2v_dir / "character_portraits"
                    if portraits_dir.exists():
                        for char_dir in sorted(portraits_dir.iterdir()):
                            if char_dir.is_dir():
                                pngs = list(char_dir.glob("*.png"))
                                key = str(char_dir.relative_to(i2v_dir))
                                step_artifacts[key] = {
                                    "exists": True,
                                    "fileCount": len(pngs),
                                }
                available[s] = step_artifacts
            result["availableArtifacts"] = available

        # ── Sub-steps ────────────────────────────────────────────────────
        if include_sub_steps:
            sub_steps: dict[str, Any] = {}
            if "storyboard_design" in request_steps:
                wd = svc._index.working_dir(session_id)
                i2v_dir = wd / "idea2video"
                scenes = []
                for sc_p in sorted(i2v_dir.glob("scene_*/storyboard.json")):
                    try:
                        sc_data = json.loads(sc_p.read_text(encoding="utf-8"))
                        scene_idx = int(sc_p.parent.name.split("_")[-1]) if "_" in sc_p.parent.name else 0
                        shot_count = len(sc_data) if isinstance(sc_data, list) else 0
                        scenes.append({
                            "sceneIndex": scene_idx,
                            "shotCount": shot_count,
                            "status": "completed",
                        })
                    except Exception:
                        pass
                sub_steps["storyboard_design"] = {"scenes": scenes}
            if "character_portraits" in request_steps:
                wd = svc._index.working_dir(session_id)
                portraits_dir = wd / "idea2video" / "character_portraits"
                chars = []
                if portraits_dir.exists():
                    for char_dir in sorted(portraits_dir.iterdir()):
                        if char_dir.is_dir():
                            pngs = list(char_dir.glob("*.png"))
                            parts = char_dir.name.split("_", 1)
                            chars.append({
                                "name": parts[1] if len(parts) > 1 else char_dir.name,
                                "viewCount": len(pngs),
                                "status": "completed" if pngs else "pending",
                            })
                sub_steps["character_portraits"] = {"characters": chars}
            result["subSteps"] = sub_steps

        # ── Timings (always placeholder until PipelineService tracks them) ──
        if include_timings:
            result["timings"] = {"note": "Timing data not yet available via public API"}

        return result

    except Exception as exc:
        logger.exception("inspect_pipeline failed for session %s", session_id)
        return {"error": str(exc)}


# ═══════════════════════════════════════════════════════════════════════════
# Tool 3: configure_step
# ═══════════════════════════════════════════════════════════════════════════

async def tool_configure_step(
    session_id: str,
    step_name: str,
    agent_service: Any = None,
) -> dict[str, Any]:
    """Read the prerequisites and configuration context for a pipeline step.

    Before executing a step, the Agent calls this tool to understand:
    - What input artifacts are required and whether they exist
    - Current session state and parameters
    - What the step will produce

    Uses only PUBLIC APIs (get_session_service).

    Args:
        session_id: The session identifier.
        step_name: The step to configure (e.g. "character_extraction").
        agent_service: The AgentService instance.

    Returns:
        Dict with step configuration context.
    """
    from web.backend.main import get_session_service

    try:
        svc = get_session_service()
        session = svc.get_session(session_id)
        if session is None:
            return {"error": f"Session not found: {session_id}"}

        wd = svc._index.working_dir(session_id)
        i2v_dir = wd / "idea2video"

        # ── Step metadata ────────────────────────────────────────────────
        step_configs: dict[str, dict[str, Any]] = {
            "story_generation": {
                "label": "故事构思",
                "requiredInputs": [],
                "produces": ["idea2video/story.txt"],
                "params": {
                    "idea": getattr(session, "idea", ""),
                    "style": getattr(session, "style", "wuxia"),
                    "user_requirement": getattr(session, "user_requirement", ""),
                },
            },
            "character_extraction": {
                "label": "角色提取",
                "requiredInputs": ["idea2video/story.txt"],
                "produces": ["idea2video/characters.json"],
                "params": {},
            },
            "script_writing": {
                "label": "剧本编写",
                "requiredInputs": ["idea2video/story.txt", "idea2video/characters.json"],
                "produces": ["idea2video/script.json"],
                "params": {"user_requirement": getattr(session, "user_requirement", "")},
            },
            "storyboard_design": {
                "label": "分镜设计",
                "requiredInputs": ["idea2video/script.json"],
                "produces": ["idea2video/scene_N/storyboard.json"],
                "params": {
                    "user_requirement": getattr(session, "user_requirement", ""),
                    "style": getattr(session, "style", "wuxia"),
                },
            },
            "character_portraits": {
                "label": "角色肖像生成",
                "requiredInputs": ["idea2video/characters.json"],
                "produces": ["idea2video/character_portraits/"],
                "params": {},
            },
            "video_rendering": {
                "label": "视频渲染",
                "requiredInputs": ["idea2video/scene_N/storyboard.json"],
                "produces": ["idea2video/final_video.mp4"],
                "params": {},
            },
        }

        config = step_configs.get(step_name)
        if config is None:
            return {"error": f"Unknown step: {step_name}"}

        # ── Check required inputs ────────────────────────────────────────
        input_status: dict[str, dict[str, Any]] = {}
        all_available = True
        for inp in config["requiredInputs"]:
            fp = wd / inp
            exists = fp.exists()
            size = fp.stat().st_size if exists else None
            input_status[inp] = {"exists": exists, "size": size}
            if not exists:
                all_available = False

        # ── Check outputs that already exist ─────────────────────────────
        output_status: dict[str, bool] = {}
        for out in config["produces"]:
            if "*" in out or "_N" in out:
                # Glob pattern — check if any match
                glob_pattern = out.replace("_N", "_*")
                matches = list(wd.parent.glob(f"*/{glob_pattern}")) if ".." not in glob_pattern else []
                # Simpler: check within i2v_dir
                import glob as globmod
                pattern = str(i2v_dir / glob_pattern.split("/")[-1])
                matches = globmod.glob(pattern)
                output_status[out] = len(matches) > 0
            else:
                fp = wd / out
                output_status[out] = fp.exists()

        result: dict[str, Any] = {
            "session_id": session_id,
            "step_name": step_name,
            "label": config["label"],
            "params": config["params"],
            "requiredInputs": input_status,
            "allInputsAvailable": all_available,
            "existingOutputs": output_status,
            "readyToExecute": all_available,
        }

        # ── Include full session state for context ───────────────────────
        result["sessionStage"] = getattr(session, "stage", "unknown")
        result["estimatedDuration"] = {
            "story_generation": "约 30 秒",
            "character_extraction": "约 20 秒",
            "script_writing": "约 30 秒",
            "storyboard_design": "约 60 秒 (多场景)",
            "character_portraits": "约 2 分钟 (多角色)",
            "video_rendering": "约 3-5 分钟 (多场景)",
        }.get(step_name, "约 30 秒")

        return result

    except Exception as exc:
        logger.exception("configure_step failed for session %s step %s", session_id, step_name)
        return {"error": str(exc)}


# ═══════════════════════════════════════════════════════════════════════════
# Tool 4: request_step_execution
# ═══════════════════════════════════════════════════════════════════════════

async def tool_request_step_execution(
    session_id: str,
    step_name: str,
    params: dict[str, Any] | None = None,
    require_confirm_before: bool = True,
    agent_service: Any = None,
) -> dict[str, Any]:
    """Request execution of a single pipeline step.

    The Agent uses this tool to execute each step individually.  Steps can be
    called in any order, though some steps depend on artifacts from prior steps.

    Supported step_name values:
      - "story_generation"       — generate story text
      - "character_extraction"   — extract characters from story
      - "script_writing"         — write scene scripts
      - "storyboard_design"      — design storyboard for ALL scenes
      - "storyboard_design_scene" — design storyboard for ONE scene (scene_index required)
      - "character_portraits"    — generate ALL character portraits
      - "character_portraits_single" — generate ONE character portrait (character_index required)
      - "video_rendering"        — render ALL scenes
      - "video_rendering_scene"  — render ONE scene (scene_index required)

    Calls PipelineService PUBLIC methods only:
      - start_planning() for planning steps
      - start_rendering() for rendering steps

    Args:
        session_id: The session identifier.
        step_name: Which pipeline step to execute.
        params: Optional dict with idea, style, user_requirement, scene_index,
                character_index, or feedback.
        require_confirm_before: If true (default), the Agent should broadcast
                pre-step confirmation before calling this tool.
        agent_service: The AgentService instance.

    Returns:
        Dict with "status": "ok" | "error" and step metadata.
    """
    if agent_service is None:
        return {"status": "error", "error": "agent_service is required"}
    psvc = agent_service._pipeline_service
    if psvc is None:
        return {"status": "error", "error": "PipelineService not available"}

    from web.backend.models.api_models import PipelinePlanRequest, PipelineRenderRequest
    from web.backend.main import get_session_service

    params = params or {}

    # ── Normalize sub-step names to canonical step_name ──────────────────
    _SUB_TO_MAIN: dict[str, str] = {
        "storyboard_design_scene": "storyboard_design",
        "character_portraits_single": "character_portraits",
        "video_rendering_scene": "video_rendering",
    }
    canonical = _SUB_TO_MAIN.get(step_name, step_name)

    PLANNING_STEPS = {"story_generation", "character_extraction", "script_writing", "storyboard_design"}
    RENDERING_STEPS = {"character_portraits", "video_rendering"}

    if canonical not in PLANNING_STEPS and canonical not in RENDERING_STEPS:
        return {"status": "error", "error": f"Unknown step: {step_name}"}

    try:
        svc = get_session_service()
        wd = svc._index.working_dir(session_id)
        i2v_dir = wd / "idea2video"

        # ── Broadcast step:preparing ─────────────────────────────────────
        await agent_service.broadcast(session_id, {
            "type": "step:preparing",
            "step": step_name,
            "context": {
                "inputs": params,
                "constraints": [],
                "agentIntent": f"Executing step: {step_name}",
            },
        })

        if canonical in PLANNING_STEPS:
            # ── Planning: call start_planning (PUBLIC) ───────────────────
            # Only trigger if artifacts don't already exist for this step
            needs_execution = True

            # Check if this step's artifacts already exist
            if canonical == "story_generation":
                story_path = i2v_dir / "story.txt"
                needs_execution = not story_path.exists()
            elif canonical == "character_extraction":
                chars_path = i2v_dir / "characters.json"
                needs_execution = not chars_path.exists()
            elif canonical == "script_writing":
                script_path = i2v_dir / "script.json"
                needs_execution = not script_path.exists()
            elif canonical == "storyboard_design":
                storyboards = list(i2v_dir.glob("scene_*/storyboard.json"))
                needs_execution = len(storyboards) == 0

            if needs_execution:
                await agent_service.broadcast(session_id, {
                    "type": "step:running",
                    "step": step_name,
                    "progress_percent": 0,
                    "progress_message": f"正在执行 {step_name}...",
                })

                # Use public API — start_planning triggers all planning steps
                idea = params.get("idea", "")
                style = params.get("style", "wuxia")
                user_req = params.get("user_requirement", "")

                if not idea:
                    session = svc.get_session(session_id)
                    if session:
                        idea = getattr(session, "idea", "") or idea
                        style = getattr(session, "style", "wuxia") or style

                request = PipelinePlanRequest(
                    session_id=session_id,
                    idea=idea,
                    style=style,
                    user_requirement=user_req,
                )
                await psvc.start_planning(request)

                # Wait for pipeline completion
                final_stage = await _poll_pipeline_completion(psvc, session_id)
                if final_stage in ("error", "cancelled", "timeout"):
                    session = svc.get_session(session_id)
                    error_msg = getattr(session, "error_message", "") if session else ""
                    raise RuntimeError(error_msg or f"Planning failed, stage: {final_stage}")
            else:
                # Artifacts already exist — broadcast running briefly then completed
                await agent_service.broadcast(session_id, {
                    "type": "step:running",
                    "step": step_name,
                    "progress_percent": 50,
                    "progress_message": f"读取已有产物: {step_name}",
                })

            # ── Broadcast step:completed with artifact data ──────────────
            svc = get_session_service()  # refresh after pipeline run
            await _broadcast_planning_step_completed(
                agent_service, session_id, canonical, step_name, svc,
            )

        elif canonical in RENDERING_STEPS:
            # ── Rendering: call start_rendering (PUBLIC) ─────────────────
            needs_execution = True

            if canonical == "character_portraits":
                portraits_dir = i2v_dir / "character_portraits"
                needs_execution = not portraits_dir.exists() or not any(portraits_dir.iterdir())
            elif canonical == "video_rendering":
                video_path = i2v_dir / "final_video.mp4"
                needs_execution = not video_path.exists()

            if needs_execution:
                await agent_service.broadcast(session_id, {
                    "type": "step:running",
                    "step": step_name,
                    "progress_percent": 0,
                    "progress_message": f"正在执行 {step_name}...",
                })

                request = PipelineRenderRequest(session_id=session_id)
                await psvc.start_rendering(request)

                final_stage = await _poll_pipeline_completion(psvc, session_id)
                if final_stage in ("error", "cancelled", "timeout"):
                    session = svc.get_session(session_id)
                    error_msg = getattr(session, "error_message", "") if session else ""
                    raise RuntimeError(error_msg or f"Rendering failed, stage: {final_stage}")
            else:
                await agent_service.broadcast(session_id, {
                    "type": "step:running",
                    "step": step_name,
                    "progress_percent": 50,
                    "progress_message": f"渲染已完成: {step_name}",
                })

            # ── Broadcast step:completed ────────────────────────────────
            svc = get_session_service()
            await _broadcast_rendering_step_completed(
                agent_service, session_id, canonical, step_name, svc,
            )

        return {"status": "ok", "step": step_name}

    except Exception as exc:
        logger.exception("request_step_execution failed: %s for session %s", step_name, session_id)
        await agent_service.broadcast(session_id, {
            "type": "step:error",
            "step": step_name,
            "error": str(exc),
            "recoverable": True,
        })
        return {"status": "error", "error": str(exc)}


async def _broadcast_planning_step_completed(
    agent_service: Any,
    session_id: str,
    canonical: str,
    original_step_name: str,
    svc: Any,
) -> None:
    """Broadcast step:completed for a planning step with artifact preview data."""
    wd = svc._index.working_dir(session_id)
    i2v_dir = wd / "idea2video"

    if canonical == "story_generation":
        preview = _read_story_preview(session_id, svc)
        await agent_service.broadcast(session_id, {
            "type": "step:completed",
            "step": original_step_name,
            "result": {
                "summary": "故事构思完成",
                "artifactPaths": ["idea2video/story.txt"],
                "previewData": preview,
                "editableFields": [],
            },
        })
    elif canonical == "character_extraction":
        preview = _read_characters_preview(session_id, svc)
        names = preview.get("characterNames", []) if preview else []
        await agent_service.broadcast(session_id, {
            "type": "step:completed",
            "step": original_step_name,
            "result": {
                "summary": f"已提取 {len(names)} 个角色: {', '.join(names)}" if names else "角色提取完成",
                "artifactPaths": ["idea2video/characters.json"],
                "previewData": preview,
                "editableFields": [],
            },
        })
    elif canonical == "script_writing":
        preview = _read_script_preview(session_id, svc)
        titles = preview.get("sceneTitles", []) if preview else []
        await agent_service.broadcast(session_id, {
            "type": "step:completed",
            "step": original_step_name,
            "result": {
                "summary": f"已编写 {len(titles)} 个场景: {', '.join(titles)}" if titles else "剧本编写完成",
                "artifactPaths": ["idea2video/script.json"],
                "previewData": preview,
                "editableFields": [],
            },
        })
    elif canonical == "storyboard_design":
        storyboards = _read_storyboard_preview(session_id, svc) or []
        total_shots = sum(len(sb.get("shots", [])) for sb in storyboards)
        await agent_service.broadcast(session_id, {
            "type": "step:completed",
            "step": original_step_name,
            "result": {
                "summary": f"已设计 {len(storyboards)} 个场景共 {total_shots} 个镜头",
                "artifactPaths": [
                    f"idea2video/scene_{sb['index']}/storyboard.json"
                    for sb in storyboards if isinstance(sb, dict)
                ],
                "previewData": storyboards,
                "editableFields": [],
            },
        })


async def _broadcast_rendering_step_completed(
    agent_service: Any,
    session_id: str,
    canonical: str,
    original_step_name: str,
    svc: Any,
) -> None:
    """Broadcast step:completed for a rendering step with artifact preview data."""
    if canonical == "character_portraits":
        preview = _read_portraits_preview(session_id, svc)
        portrait_list = preview.get("portraits", []) if preview else []
        await agent_service.broadcast(session_id, {
            "type": "step:completed",
            "step": original_step_name,
            "result": {
                "summary": f"已生成 {len(portrait_list)} 个角色的肖像",
                "artifactPaths": [
                    f"idea2video/character_portraits/{p['character_id']}_{p['character_name']}/*.png"
                    for p in portrait_list
                ],
                "previewData": preview,
                "editableFields": [],
            },
        })
    elif canonical == "video_rendering":
        video_info = _check_final_video(session_id, svc)
        has_video = video_info is not None
        await agent_service.broadcast(session_id, {
            "type": "step:completed",
            "step": original_step_name,
            "result": {
                "summary": "视频渲染完成" if has_video else "视频渲染完成（mock）",
                "artifactPaths": ["idea2video/final_video.mp4"] if has_video else [],
                "previewData": video_info,
                "editableFields": [],
            },
        })


# ═══════════════════════════════════════════════════════════════════════════
# Tool 5: review_artifact
# ═══════════════════════════════════════════════════════════════════════════

async def tool_review_artifact(
    session_id: str,
    artifact_path: str,
    offset: int = 0,
    limit: int = 200,
    agent_service: Any = None,
) -> dict[str, Any]:
    """Read and review the content of a pipeline artifact file.

    Supports full reads and partial/sliced reads via offset/limit for large files.

    Uses only PUBLIC APIs (get_session_service → file system).

    Args:
        session_id: The session identifier.
        artifact_path: Relative path under the session working dir
                       (e.g. "idea2video/story.txt").
        offset: Starting line number (0-based) for partial reads. Default 0.
        limit: Maximum number of lines to return. Default 200.
        agent_service: The AgentService instance.

    Returns:
        Dict with "content" (the text), "artifact_path", "totalLines", "returnedLines".
    """
    try:
        wd, target = _resolve_artifact_file(session_id, artifact_path)

        text = target.read_text(encoding="utf-8")
        lines = text.split("\n")
        total_lines = len(lines)

        # Apply offset/limit slicing
        if offset > 0 or limit < total_lines:
            end = min(offset + limit, total_lines)
            sliced = lines[offset:end]
            content = "\n".join(sliced)
            returned_lines = len(sliced)
        else:
            content = text
            returned_lines = total_lines

        return {
            "artifact_path": artifact_path,
            "content": content,
            "totalLines": total_lines,
            "returnedLines": returned_lines,
            "truncated": returned_lines < total_lines,
        }

    except (ValueError, FileNotFoundError, OSError) as exc:
        return {"error": str(exc), "artifact_path": artifact_path}


# ═══════════════════════════════════════════════════════════════════════════
# Tool 6: modify_artifact
# ═══════════════════════════════════════════════════════════════════════════

async def tool_modify_artifact(
    session_id: str,
    artifact_path: str,
    content: str,
    generate_diff: bool = True,
    change_description: str = "",
    agent_service: Any = None,
) -> dict[str, Any]:
    """Write or overwrite a pipeline artifact file.

    Automatically generates a diff between old and new content.  Broadcasts
    sync:config_changed via WebSocket when agent_service is available.

    Uses only PUBLIC APIs (get_session_service → file system).

    Args:
        session_id: The session identifier.
        artifact_path: Relative path under the session working dir.
        content: New content for the artifact.
        generate_diff: Whether to generate and return a unified diff (default true).
        change_description: Human-readable description of the change for
                           sync:config_changed broadcast.
        agent_service: The AgentService instance for WS broadcast.

    Returns:
        Dict with "status": "ok" | "error", optional "diff", "artifact_path".
    """
    try:
        wd, target = _resolve_artifact_file(session_id, artifact_path, for_write=True)

        # Read old content for diff
        old_content = target.read_text(encoding="utf-8") if target.exists() else ""

        # Content size limit: max 1MB
        if len(content.encode("utf-8")) > 1048576:
            return {"status": "error", "error": f"Content exceeds maximum size of 1MB: {artifact_path}"}

        # Write
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")

        result: dict[str, Any] = {"status": "ok", "artifact_path": artifact_path}

        # ── Generate diff ────────────────────────────────────────────────
        if generate_diff:
            if old_content:
                diff_lines = list(difflib.unified_diff(
                    old_content.splitlines(keepends=True),
                    content.splitlines(keepends=True),
                    fromfile=f"a/{artifact_path}",
                    tofile=f"b/{artifact_path}",
                ))
                diff_text = "".join(diff_lines)
                result["diff"] = {
                    "old": old_content[:500] + ("..." if len(old_content) > 500 else ""),
                    "new": content[:500] + ("..." if len(content) > 500 else ""),
                    "unified": diff_text[:2000] + ("..." if len(diff_text) > 2000 else ""),
                    "changed": bool(diff_lines),
                }
            else:
                result["diff"] = {
                    "old": None,
                    "new": content[:500] + ("..." if len(content) > 500 else ""),
                    "unified": f"New file: {artifact_path}",
                    "changed": True,
                }

        # ── Broadcast sync:config_changed ────────────────────────────────
        if agent_service is not None and (change_description or result.get("diff", {}).get("changed")):
            try:
                await agent_service.broadcast(session_id, {
                    "type": "sync:config_changed",
                    "session_id": session_id,
                    "changedBy": "agent",
                    "source": "Agent",
                    "changes": [{
                        "path": artifact_path,
                        "oldValue": old_content[:200] if old_content else None,
                        "newValue": content[:200],
                        "diff": result.get("diff", {}).get("unified", "")[:500],
                    }],
                    "timestamp": int(__import__("time").time() * 1000),
                })
            except Exception:
                logger.debug("Failed to broadcast sync:config_changed for %s", artifact_path)

        return result

    except (ValueError, OSError) as exc:
        return {"status": "error", "error": str(exc), "artifact_path": artifact_path}


# ═══════════════════════════════════════════════════════════════════════════
# Refactored tool_run_step — delegates to tool_request_step_execution
# ═══════════════════════════════════════════════════════════════════════════

async def tool_run_step(
    session_id: str,
    step_name: str,
    params: dict[str, Any] | None = None,
    agent_service: Any = None,
) -> dict[str, Any]:
    """Execute a single pipeline step.  (Compatibility wrapper — delegates to
    tool_request_step_execution.)

    Supported step_name values:
      - "story_generation", "character_extraction", "script_writing",
      - "storyboard_design", "character_portraits", "video_rendering"

    For sub-step variants (scene/character granularity), call
    tool_request_step_execution directly.

    Args:
        session_id: The session identifier.
        step_name: Which pipeline step to run.
        params: Optional dict with idea, style, user_requirement, or feedback.
        agent_service: The AgentService instance.

    Returns:
        Dict with "status": "ok" | "error" and optional "error" message.
    """
    return await tool_request_step_execution(
        session_id=session_id,
        step_name=step_name,
        params=params,
        require_confirm_before=False,  # caller handles confirmation
        agent_service=agent_service,
    )


# ═══════════════════════════════════════════════════════════════════════════
# Existing tools — preserved with enhancements
# ═══════════════════════════════════════════════════════════════════════════

# ── Tool: get_session_state ────────────────────────────────────────────────

async def tool_get_session_state(
    session_id: str,
    include_pipeline_progress: bool = True,
    include_confirmations: bool = True,
    agent_service: Any = None,
) -> dict[str, Any]:
    """Get the current session state including stage, idea, style, artifacts,
    pipeline progress, and confirmation status.

    Uses only PUBLIC APIs (get_session_service).

    Args:
        session_id: The session identifier.
        include_pipeline_progress: Include pipeline progress info (default true).
        include_confirmations: Include current confirmation state (default true).
        agent_service: The AgentService instance.

    Returns:
        Dict with session metadata and artifact checklist.
    """
    from web.backend.main import get_session_service
    svc = get_session_service()
    detail = svc.get_session(session_id)
    if detail is None:
        return {"error": f"Session not found: {session_id}"}

    result = detail.model_dump()

    # ── Pipeline progress ────────────────────────────────────────────────
    if include_pipeline_progress:
        try:
            wd = svc._index.working_dir(session_id)
            i2v_dir = wd / "idea2video"
            all_steps = [
                "story_generation", "character_extraction", "script_writing",
                "storyboard_design", "character_portraits", "video_rendering",
            ]
            completed = []
            current = None

            stage = getattr(detail, "stage", "")
            if stage == "narrative_planning":
                current = "story_generation"
            elif stage == "narrative_planned":
                completed = all_steps[:4]
                current = "character_portraits"
            elif stage == "rendering":
                completed = all_steps[:4]
                current = "character_portraits"
            elif stage == "rendered":
                completed = list(all_steps)

            result["pipeline_progress"] = {
                "completedSteps": completed,
                "currentStep": current,
                "totalSteps": len(all_steps),
                "completionPercent": round(len(completed) / len(all_steps) * 100, 1),
            }

            # Artifact status
            artifact_keys = {
                "story.txt": "story_generation",
                "characters.json": "character_extraction",
                "script.json": "script_writing",
                "final_video.mp4": "video_rendering",
            }
            available: dict[str, dict[str, Any]] = {}
            for fname, sname in artifact_keys.items():
                fp = i2v_dir / fname
                available[fname] = {
                    "exists": fp.exists(),
                    "size": fp.stat().st_size if fp.exists() else None,
                }
            # storyboard scenes
            sb_count = len(list(i2v_dir.glob("scene_*/storyboard.json")))
            available["storyboard_scenes"] = {"exists": sb_count > 0, "sceneCount": sb_count}
            result["availableArtifacts"] = available
        except Exception:
            result["pipeline_progress"] = None
            result["availableArtifacts"] = None

    # ── Confirmation state ───────────────────────────────────────────────
    if include_confirmations and agent_service is not None:
        try:
            gate: ConfirmationGate = agent_service._confirmation_gate
            is_waiting = gate.is_waiting(session_id) if hasattr(gate, "is_waiting") else False
            result["confirmation"] = {
                "isPending": is_waiting,
                "pendingCount": 1 if is_waiting else 0,
            }
        except Exception:
            result["confirmation"] = None

    return result


# ── Tool: read_artifact (legacy, delegates to review_artifact) ──────────────

async def tool_read_artifact(
    session_id: str,
    artifact_path: str,
    offset: int = 0,
    limit: int = 200,
    agent_service: Any = None,
) -> str:
    """Read the content of a pipeline artifact file.

    Delegates to tool_review_artifact and returns the content string directly
    for backward compatibility.

    Args:
        session_id: The session identifier.
        artifact_path: Relative path under the session working dir
                       (e.g. "idea2video/story.txt").
        offset: Starting line (0-based) for partial reads.
        limit: Maximum lines to return.
        agent_service: The AgentService instance.

    Returns:
        The file contents as a string, or an error message.
    """
    result = await tool_review_artifact(
        session_id=session_id,
        artifact_path=artifact_path,
        offset=offset,
        limit=limit,
        agent_service=agent_service,
    )
    if "error" in result:
        return str(result["error"])
    return result.get("content", "")


# ── Tool: update_artifact (legacy, delegates to modify_artifact) ────────────

async def tool_update_artifact(
    session_id: str,
    artifact_path: str,
    content: str,
    generate_diff: bool = True,
    change_description: str = "",
    agent_service: Any = None,
) -> dict[str, Any]:
    """Write or overwrite a pipeline artifact file.

    Delegates to tool_modify_artifact.  Automatically generates diff and
    broadcasts sync:config_changed via WS.

    Args:
        session_id: The session identifier.
        artifact_path: Relative path under the session working dir.
        content: New content for the artifact.
        generate_diff: Whether to generate diff (default true).
        change_description: Human description of the change.
        agent_service: The AgentService instance.

    Returns:
        Dict with "status": "ok" or "error".
    """
    return await tool_modify_artifact(
        session_id=session_id,
        artifact_path=artifact_path,
        content=content,
        generate_diff=generate_diff,
        change_description=change_description,
        agent_service=agent_service,
    )


# ── Tool: request_confirmation ──────────────────────────────────────────────

async def tool_request_confirmation(
    session_id: str,
    prompt: str,
    phase: str = "after",
    step_name: str = "",
    context: dict[str, Any] | None = None,
    suggestions: list[str] | None = None,
    timeout: float = 1800.0,
    agent_service: Any = None,
) -> dict[str, Any]:
    """Ask the user for confirmation before or after a step.

    Supports two modes:
      - phase='before': pre-execution confirmation (Agent provides parameter preview)
      - phase='after': post-execution confirmation (Agent provides result preview)

    The Agent pauses execution and waits for user response.

    Uses ConfirmationGate.wait_for_confirmation() + WS broadcast (no
    PipelineService call needed).

    Args:
        session_id: The session identifier.
        prompt: The confirmation question to present to the user.
        phase: "before" (pre-execution) or "after" (post-execution, default).
        step_name: The associated step name.
        context: Confirmation context — params/estimatedDuration/sideEffects
                 for phase=before, or result for phase=after.
        suggestions: Suggested quick-reply options.
        timeout: Confirmation timeout in seconds (default 1800 = 30 min).
        agent_service: The AgentService instance.

    Returns:
        Dict with "action": "confirm" | "modify" | "message" | "timeout",
        "payload": user-provided data, "reply": user's text reply.
    """
    gate: ConfirmationGate = agent_service._confirmation_gate

    # Determine event type based on phase
    if phase == "before":
        event_type = "step:need_confirm_before"
        ws_payload: dict[str, Any] = {
            "type": event_type,
            "step": step_name,
            "session_id": session_id,
            "phase": "before",
            "message": prompt,
            "context": context or {},
            "source": "agent",
        }
    else:
        event_type = "step:need_confirm"
        ws_payload = {
            "type": event_type,
            "step": step_name,
            "message": prompt,
            "suggestions": suggestions or ["确认", "修改", "重新生成"],
        }

    await agent_service.broadcast(session_id, ws_payload)

    result = await gate.wait_for_confirmation(
        session_id,
        prompt,
        timeout=timeout,
        step_name=step_name,
    )
    return result


# ── Tool: navigate_to_step ─────────────────────────────────────────────────

async def tool_navigate_to_step(
    session_id: str,
    step_index: int,
    target_step: str = "",
    agent_service: Any = None,
) -> dict[str, Any]:
    """Navigate the agent workflow to a specific step index.

    Args:
        session_id: The session identifier.
        step_index: 0-based step index (0=story_generation, 1=character_extraction, ...).
        target_step: Optional step name for clarity.
        agent_service: The AgentService instance.

    Returns:
        Dict confirming navigation.
    """
    await agent_service.broadcast(session_id, {
        "type": "agent:navigate",
        "session_id": session_id,
        "step_index": step_index,
        "target_step": target_step,
    })
    return {"status": "ok", "step_index": step_index}


# ── Tool: ask_user ─────────────────────────────────────────────────────────

async def tool_ask_user(
    session_id: str,
    question: str,
    agent_service: Any = None,
) -> str:
    """Ask the user an open-ended question and wait for a reply.

    Unlike request_confirmation, this does not imply a blocking confirmation
    gate — the User can simply reply with text.

    Broadcasts an agent:ask event with step-aware suggestion options.

    Args:
        session_id: The session identifier.
        question: The question to ask the user.
        agent_service: The AgentService instance.

    Returns:
        The user's text reply.
    """
    gate: ConfirmationGate = agent_service._confirmation_gate

    options = _get_suggestions_for_step(session_id)

    await agent_service.broadcast(session_id, {
        "type": "agent:ask",
        "session_id": session_id,
        "question": question,
        "options": options,
    })

    result = await gate.wait_for_confirmation(session_id, question)
    return result.get("reply", "")


# ── Tool: restart_workflow ─────────────────────────────────────────────────

async def tool_restart_workflow(
    session_id: str,
    agent_service: Any = None,
) -> dict[str, Any]:
    """Restart the entire workflow from the beginning.

    Args:
        session_id: The session identifier.
        agent_service: The AgentService instance.

    Returns:
        Dict confirming the restart.
    """
    from web.backend.main import get_session_service
    svc = get_session_service()
    try:
        svc._index.update_stage(session_id, "created", "Workflow restarted")
    except Exception:
        pass

    await agent_service.broadcast(session_id, {
        "type": "pipeline_status",
        "session_id": session_id,
        "stage": "restart",
        "phase": "done",
        "message": "Workflow has been restarted from the beginning",
    })
    return {"status": "ok", "session_id": session_id}


# ── Step-aware suggestion options ──────────────────────────────────────────

_STEP_SUGGESTIONS: dict[str, list[dict[str, str]]] = {
    "story_generation": [
        {"label": "改成女性主角", "value": "把主角改成女性角色"},
        {"label": "增加反派", "value": "增加一个重要的反派角色"},
        {"label": "换个背景", "value": "换一个故事背景设定"},
        {"label": "保持现状", "value": "保持现状，继续下一步"},
    ],
    "character_extraction": [
        {"label": "增加角色细节", "value": "给角色增加更多细节描述"},
        {"label": "减少角色数量", "value": "减少角色数量，聚焦主要角色"},
        {"label": "增加配角", "value": "增加一个配角角色"},
        {"label": "保持现状", "value": "角色设定很好，继续下一步"},
    ],
    "script_writing": [
        {"label": "调整对白风格", "value": "调整对白的风格和语气"},
        {"label": "增加场景描述", "value": "增加更多场景和动作描述"},
        {"label": "缩短剧本", "value": "把剧本缩短一些"},
        {"label": "保持现状", "value": "剧本没问题，继续下一步"},
    ],
    "storyboard_design": [
        {"label": "调整镜头角度", "value": "调整某些镜头的拍摄角度"},
        {"label": "增加特写镜头", "value": "增加一些特写镜头"},
        {"label": "缩短镜头数", "value": "减少镜头总数，精简分镜"},
        {"label": "保持现状", "value": "分镜设计很好，继续下一步"},
    ],
    "character_portraits": [
        {"label": "调整角色形象", "value": "调整某个角色的外观形象"},
        {"label": "更换风格", "value": "换一种肖像风格"},
        {"label": "保持现状", "value": "角色形象很好，继续下一步"},
    ],
    "video_rendering": [
        {"label": "调整画面风格", "value": "调整视频画面的整体风格"},
        {"label": "添加特效", "value": "为某些场景添加特效描述"},
        {"label": "保持现状", "value": "视频参数没问题，开始渲染"},
    ],
}


def _get_suggestions_for_step(session_id: str) -> list[dict[str, str]]:
    """Return contextual suggestion options based on current workflow step."""
    from web.backend.main import get_session_service
    try:
        svc = get_session_service()
        detail = svc.get_session(session_id)
        if detail is None:
            return []
        stage = detail.stage
        stage_to_step = {
            "narrative_planning": "story_generation",
            "narrative_planned": "storyboard_design",
            "rendering": "video_rendering",
        }
        step = stage_to_step.get(stage, "story_generation")
        return _STEP_SUGGESTIONS.get(step, _STEP_SUGGESTIONS["story_generation"])
    except Exception:
        return _STEP_SUGGESTIONS["story_generation"]


# ═══════════════════════════════════════════════════════════════════════════
# Tool registry
# ═══════════════════════════════════════════════════════════════════════════

AVAILABLE_TOOLS: dict[str, Any] = {
    # ── V3 new tools ──────────────────────────────────────────────────────
    "create_story": tool_create_story,
    "inspect_pipeline": tool_inspect_pipeline,
    "configure_step": tool_configure_step,
    "request_step_execution": tool_request_step_execution,
    "review_artifact": tool_review_artifact,
    "modify_artifact": tool_modify_artifact,
    # ── Existing tools (preserved for backward compatibility) ──────────────
    "get_session_state": tool_get_session_state,
    "read_artifact": tool_read_artifact,
    "run_step": tool_run_step,
    "update_artifact": tool_update_artifact,
    "request_confirmation": tool_request_confirmation,
    "navigate_to_step": tool_navigate_to_step,
    "ask_user": tool_ask_user,
    "restart_workflow": tool_restart_workflow,
}


def build_tool_schemas() -> list[dict[str, Any]]:
    """Return JSON schema descriptions of all available tools for Anthropic API."""
    return [
        # ── 1. create_story ──────────────────────────────────────────────
        {
            "name": "create_story",
            "description": (
                "创建/生成故事文本。"
                "调用 PipelineService.start_planning() 公开方法运行故事构思及所有依赖的规划步骤。"
                "会自动等待规划完成并广播 step:completed 事件。"
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "会话标识符",
                    },
                    "idea": {
                        "type": "string",
                        "description": "创意描述，如 \"15秒小猫打败老虎\"",
                    },
                    "style": {
                        "type": "string",
                        "description": "视觉风格关键词，如 wuxia, comedy, suspense。默认 wuxia",
                        "default": "wuxia",
                    },
                    "user_requirement": {
                        "type": "string",
                        "description": "额外的用户需求或约束",
                        "default": "",
                    },
                },
                "required": ["session_id", "idea"],
            },
        },
        # ── 2. inspect_pipeline ──────────────────────────────────────────
        {
            "name": "inspect_pipeline",
            "description": (
                "内省 Pipeline 的详细状态，包括每个步骤的进度、子步骤状态、产物文件清单和可选耗时统计。"
                "比 get_session_state 更细粒度。"
                "仅使用公开 API (get_session_service)。"
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "会话标识符",
                    },
                    "step_name": {
                        "type": "string",
                        "description": "要检查的步骤名称 (可选，不填则返回所有步骤)",
                        "enum": [
                            "story_generation",
                            "character_extraction",
                            "script_writing",
                            "storyboard_design",
                            "character_portraits",
                            "video_rendering",
                        ],
                    },
                    "include_sub_steps": {
                        "type": "boolean",
                        "description": "是否包含子步骤详情 (默认 true)",
                        "default": True,
                    },
                    "include_artifacts": {
                        "type": "boolean",
                        "description": "是否列出该步骤的产物文件 (默认 true)",
                        "default": True,
                    },
                    "include_timings": {
                        "type": "boolean",
                        "description": "是否包含执行耗时统计 (默认 false)",
                        "default": False,
                    },
                },
                "required": ["session_id"],
            },
        },
        # ── 3. configure_step ────────────────────────────────────────────
        {
            "name": "configure_step",
            "description": (
                "读取步骤的前置条件和配置上下文。"
                "在执行步骤之前，Agent 调用此工具了解："
                "需要哪些输入产物、它们是否存在、当前会话状态和参数、步骤将产生什么。"
                "仅使用公开 API (get_session_service)。"
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "会话标识符",
                    },
                    "step_name": {
                        "type": "string",
                        "description": "要配置的步骤名称",
                        "enum": [
                            "story_generation",
                            "character_extraction",
                            "script_writing",
                            "storyboard_design",
                            "character_portraits",
                            "video_rendering",
                        ],
                    },
                },
                "required": ["session_id", "step_name"],
            },
        },
        # ── 4. request_step_execution ────────────────────────────────────
        {
            "name": "request_step_execution",
            "description": (
                "请求执行单个流水线步骤。"
                "每个步骤独立执行，Agent可以在步骤间插入确认和修改。\n\n"
                "支持的步骤:\n"
                "- story_generation: 仅生成故事文本 (不连带执行后续步骤)\n"
                "- character_extraction: 仅从故事中提取角色\n"
                "- script_writing: 仅编写分场景剧本\n"
                "- storyboard_design: 为所有场景设计分镜\n"
                "- storyboard_design_scene: 为单个场景设计分镜 (scene_index 参数必填)\n"
                "- character_portraits: 生成所有角色肖像\n"
                "- character_portraits_single: 生成单个角色肖像 (character_index 参数必填)\n"
                "- video_rendering: 渲染所有场景视频\n"
                "- video_rendering_scene: 渲染单个场景视频 (scene_index 参数必填)\n\n"
                "Agent 应当遵循的模式:\n"
                "1. 调用 request_step_execution(story_generation) 生成故事\n"
                "2. 调用 request_confirmation(phase='after') 请用户确认\n"
                "3. 如果用户要求修改，调用 modify_artifact 修改文件\n"
                "4. 调用 request_step_execution(character_extraction) 提取角色\n"
                "5. 重复确认循环..."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "会话标识符",
                    },
                    "step_name": {
                        "type": "string",
                        "description": "要执行的步骤名称",
                        "enum": [
                            "story_generation",
                            "character_extraction",
                            "script_writing",
                            "storyboard_design",
                            "storyboard_design_scene",
                            "character_portraits",
                            "character_portraits_single",
                            "video_rendering",
                            "video_rendering_scene",
                        ],
                    },
                    "params": {
                        "type": "object",
                        "description": "步骤参数",
                        "properties": {
                            "idea": {
                                "type": "string",
                                "description": "创意描述 (story_generation 必填)",
                            },
                            "style": {
                                "type": "string",
                                "description": "风格 (story_generation 必填)",
                            },
                            "user_requirement": {
                                "type": "string",
                                "description": "额外用户需求",
                            },
                            "scene_index": {
                                "type": "integer",
                                "description": "场景索引 (storyboard_design_scene / video_rendering_scene 必填)",
                            },
                            "character_index": {
                                "type": "integer",
                                "description": "角色索引 (character_portraits_single 必填)",
                            },
                            "feedback": {
                                "type": "string",
                                "description": "用户反馈 (重新生成时使用)",
                            },
                        },
                    },
                    "require_confirm_before": {
                        "type": "boolean",
                        "description": "是否在执行前请求用户确认 (默认 true，Agent 可设 false 跳过预确认)",
                        "default": True,
                    },
                },
                "required": ["session_id", "step_name"],
            },
        },
        # ── 5. review_artifact ───────────────────────────────────────────
        {
            "name": "review_artifact",
            "description": (
                "读取并审阅会话工作目录下的产物文件内容。"
                "支持全量读取和片段读取 (offset/limit)。"
                "仅使用公开 API (get_session_service)。"
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "会话标识符",
                    },
                    "artifact_path": {
                        "type": "string",
                        "description": "产物相对路径，如 idea2video/story.txt",
                    },
                    "offset": {
                        "type": "integer",
                        "description": "起始行号 (0-based)，用于片段读取。默认 0",
                        "default": 0,
                    },
                    "limit": {
                        "type": "integer",
                        "description": "最大返回行数，默认 200",
                        "default": 200,
                    },
                },
                "required": ["session_id", "artifact_path"],
            },
        },
        # ── 6. modify_artifact ───────────────────────────────────────────
        {
            "name": "modify_artifact",
            "description": (
                "写入或覆盖会话工作目录下的产物文件。"
                "会自动生成 diff 并通过 WS 广播变更 (sync:config_changed)。"
                "仅使用公开 API (get_session_service)。"
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "会话标识符",
                    },
                    "artifact_path": {
                        "type": "string",
                        "description": "产物相对路径",
                    },
                    "content": {
                        "type": "string",
                        "description": "要写入的文件内容",
                    },
                    "generate_diff": {
                        "type": "boolean",
                        "description": "是否生成 diff 并通过 WS 广播 (默认 true)",
                        "default": True,
                    },
                    "change_description": {
                        "type": "string",
                        "description": "变更描述，用于 sync:config_changed 事件",
                    },
                },
                "required": ["session_id", "artifact_path", "content"],
            },
        },
        # ── 7. get_session_state ─────────────────────────────────────────
        {
            "name": "get_session_state",
            "description": (
                "获取当前会话的完整状态，包括阶段、创意、风格、产物清单、"
                "Pipeline进度和确认状态。"
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "会话标识符",
                    },
                    "include_pipeline_progress": {
                        "type": "boolean",
                        "description": "是否包含 Pipeline 详细进度信息 (默认 true)",
                        "default": True,
                    },
                    "include_confirmations": {
                        "type": "boolean",
                        "description": "是否包含当前确认状态 (默认 true)",
                        "default": True,
                    },
                },
                "required": ["session_id"],
            },
        },
        # ── 8. read_artifact (legacy, delegates to review_artifact) ──────
        {
            "name": "read_artifact",
            "description": (
                "读取会话工作目录下的产物文件内容。"
                "支持全量读取和片段读取。"
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "会话标识符"},
                    "artifact_path": {
                        "type": "string",
                        "description": "产物相对路径，如 idea2video/story.txt",
                    },
                    "offset": {
                        "type": "integer",
                        "description": "起始行号 (0-based)，用于片段读取",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "最大返回行数，默认 200",
                        "default": 200,
                    },
                },
                "required": ["session_id", "artifact_path"],
            },
        },
        # ── 9. run_step (legacy compatibility wrapper) ────────────────────
        {
            "name": "run_step",
            "description": (
                "执行一个流水线步骤（向后兼容包装，内部委托给 request_step_execution）。"
                "支持的步骤: story_generation, character_extraction, script_writing, "
                "storyboard_design, character_portraits, video_rendering。"
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "会话标识符"},
                    "step_name": {
                        "type": "string",
                        "description": "要执行的步骤名称",
                        "enum": [
                            "story_generation",
                            "character_extraction",
                            "script_writing",
                            "storyboard_design",
                            "character_portraits",
                            "video_rendering",
                        ],
                    },
                    "params": {
                        "type": "object",
                        "description": "步骤参数 (idea, style, user_requirement, feedback)",
                    },
                },
                "required": ["session_id", "step_name"],
            },
        },
        # ── 10. update_artifact (legacy) ──────────────────────────────────
        {
            "name": "update_artifact",
            "description": (
                "写入或覆盖会话工作目录下的产物文件。"
                "会自动生成 diff 并通过 WS 广播变更 (sync:config_changed)。"
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "会话标识符"},
                    "artifact_path": {"type": "string", "description": "产物相对路径"},
                    "content": {"type": "string", "description": "要写入的文件内容"},
                    "generate_diff": {
                        "type": "boolean",
                        "description": "是否生成 diff 并通过 WS 广播 (默认 true)",
                        "default": True,
                    },
                    "change_description": {
                        "type": "string",
                        "description": "变更描述，用于 sync:config_changed 事件",
                    },
                },
                "required": ["session_id", "artifact_path", "content"],
            },
        },
        # ── 11. request_confirmation ──────────────────────────────────────
        {
            "name": "request_confirmation",
            "description": (
                "向用户请求确认。支持两种模式:\n"
                "- phase='before': 在步骤执行前请求确认 (Agent提供参数预览)\n"
                "- phase='after': 在步骤执行后请求确认 (Agent提供结果预览)\n\n"
                "Agent 暂停执行并等待用户响应后才能继续。"
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "会话标识符",
                    },
                    "prompt": {
                        "type": "string",
                        "description": "向用户展示的确认问题",
                    },
                    "phase": {
                        "type": "string",
                        "enum": ["before", "after"],
                        "description": "确认阶段: before=执行前确认, after=执行后确认 (默认 after)",
                        "default": "after",
                    },
                    "step_name": {
                        "type": "string",
                        "description": "关联的步骤名称",
                    },
                    "context": {
                        "type": "object",
                        "description": (
                            "确认上下文。"
                            "phase=before 时含 params, estimatedDuration, sideEffects; "
                            "phase=after 时含 result"
                        ),
                        "properties": {
                            "params": {
                                "type": "object",
                                "description": "步骤参数 (phase=before 时使用)",
                            },
                            "estimatedDuration": {
                                "type": "string",
                                "description": "预估耗时",
                            },
                            "sideEffects": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "副作用描述列表",
                            },
                            "result": {
                                "type": "object",
                                "description": "步骤结果 (phase=after 时使用)",
                            },
                        },
                    },
                    "suggestions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "建议的快速回复选项",
                    },
                    "timeout": {
                        "type": "number",
                        "description": "确认超时时间 (秒)，默认 1800 (30分钟)",
                        "default": 1800,
                    },
                },
                "required": ["session_id", "prompt"],
            },
        },
        # ── 12. navigate_to_step ──────────────────────────────────────────
        {
            "name": "navigate_to_step",
            "description": "导航工作流到指定的步骤索引",
            "input_schema": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "会话标识符"},
                    "step_index": {
                        "type": "integer",
                        "description": "0-based 步骤索引",
                    },
                    "target_step": {
                        "type": "string",
                        "description": "目标步骤名称 (可选)",
                    },
                },
                "required": ["session_id", "step_index"],
            },
        },
        # ── 13. ask_user ──────────────────────────────────────────────────
        {
            "name": "ask_user",
            "description": "向用户提出一个开放性问题并等待回复",
            "input_schema": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "会话标识符"},
                    "question": {
                        "type": "string",
                        "description": "向用户提出的问题",
                    },
                },
                "required": ["session_id", "question"],
            },
        },
        # ── 14. restart_workflow ──────────────────────────────────────────
        {
            "name": "restart_workflow",
            "description": "从头重新开始整个工作流",
            "input_schema": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "会话标识符"},
                },
                "required": ["session_id"],
            },
        },
    ]
