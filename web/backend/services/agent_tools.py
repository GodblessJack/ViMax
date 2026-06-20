"""Pipeline Tools for the Agent -- plain async functions with docstrings and type hints.

Each tool is a callable that the AgentService registers with the LLM.
Tools wrap PipelineService methods and add confirmation-gate integration.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Callable

from web.backend.services.confirmation_gate import ConfirmationGate

logger = logging.getLogger(__name__)


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


# ── Tool: get_session_state ─────────────────────────────────────────────

async def tool_get_session_state(
    session_id: str,
    agent_service: Any,
) -> dict[str, Any]:
    """Get the current session state including stage, idea, style, artifacts.

    Args:
        session_id: The session identifier.
        agent_service: The AgentService instance.

    Returns:
        Dict with session metadata and artifact checklist.
    """
    from web.backend.main import get_session_service
    svc = get_session_service()
    detail = svc.get_session(session_id)
    if detail is None:
        return {"error": f"Session not found: {session_id}"}
    return detail.model_dump()


# ── Tool: read_artifact ─────────────────────────────────────────────────

async def tool_read_artifact(
    session_id: str,
    artifact_path: str,
    agent_service: Any,
) -> str:
    """Read the content of a pipeline artifact file.

    Args:
        session_id: The session identifier.
        artifact_path: Relative path under the session working dir
                       (e.g. "idea2video/story.txt").

    Returns:
        The file contents as a string, or an error message.
    """
    from web.backend.main import get_session_service
    svc = get_session_service()
    session = svc._index.get(session_id)
    if session is None:
        return f"Session not found: {session_id}"
    try:
        wd = svc._index.working_dir(session_id)
        artifact_file = (wd / artifact_path).resolve()
        # Containment check: prevent path traversal
        wd_resolved = wd.resolve()
        if wd_resolved not in artifact_file.parents and artifact_file != wd_resolved:
            return {"error": f"Path traversal blocked: {artifact_path}"}
        if not artifact_file.exists():
            return f"Artifact not found: {artifact_path}"
        return artifact_file.read_text(encoding="utf-8")
    except (KeyError, ValueError, OSError) as exc:
        return f"Error reading artifact: {exc}"


# ── Tool: run_step ──────────────────────────────────────────────────────

async def tool_run_step(
    session_id: str,
    step_name: str,
    params: dict[str, Any] | None = None,
    agent_service: Any = None,
) -> dict[str, Any]:
    """Execute a single pipeline step (planning or rendering).

    Supported step_name values:
      - "story_generation"
      - "character_extraction"
      - "script_writing"
      - "storyboard_design"
      - "character_portraits"
      - "video_rendering"

    Args:
        session_id: The session identifier.
        step_name: Which pipeline step to run.
        params: Optional dict with idea, style, user_requirement, or feedback.
        agent_service: The AgentService instance for WS broadcast and pipeline access.

    Returns:
        Dict with "status": "ok" | "error" and optional "error" message.
    """
    psvc = agent_service._pipeline_service
    if psvc is None:
        return {"status": "error", "error": "PipelineService not available"}

    # Determine which pipeline method to call based on step_name
    pipeline_steps = {
        "story_generation": ("planning", "story_generation"),
        "character_extraction": ("planning", "character_extraction"),
        "script_writing": ("planning", "script_writing"),
        "storyboard_design": ("planning", "storyboard_design"),
        "character_portraits": ("rendering", "character_portraits"),
        "video_rendering": ("rendering", "video_rendering"),
    }

    if step_name not in pipeline_steps:
        return {"status": "error", "error": f"Unknown step: {step_name}"}

    phase, sub_step = pipeline_steps[step_name]

    import asyncio

    from web.backend.models.api_models import PipelinePlanRequest, PipelineRenderRequest
    from web.backend.main import get_session_service

    params = params or {}

    try:
        await agent_service.broadcast(session_id, {
            "type": "step:preparing",
            "step": step_name,
            "context": {
                "inputs": params,
                "constraints": [],
                "agentIntent": f"Executing step: {step_name}",
            },
        })

        if phase == "planning":
            if step_name == "story_generation":
                # ── Trigger full planning pipeline ──────────────────────
                request = PipelinePlanRequest(
                    session_id=session_id,
                    idea=params.get("idea", ""),
                    style=params.get("style", "wuxia"),
                    user_requirement=params.get("user_requirement", ""),
                )

                await agent_service.broadcast(session_id, {
                    "type": "step:running",
                    "step": step_name,
                    "progress_percent": 0,
                    "progress_message": "正在构思故事...",
                })

                cancel_evt = asyncio.Event()
                await psvc._run_planning(session_id, request, cancel_evt)

                # Verify planning succeeded
                svc = get_session_service()
                session = svc.get_session(session_id)
                if session is not None and getattr(session, "stage", "") in ("error", "cancelled"):
                    error_msg = getattr(session, "error_message", "") or f"规划失败，阶段: {session.stage}"
                    raise RuntimeError(error_msg)

                await agent_service.broadcast(session_id, {
                    "type": "step:completed",
                    "step": step_name,
                    "result": {
                        "summary": "故事构思完成",
                        "artifactPaths": ["idea2video/story.txt"],
                        "previewData": None,
                        "editableFields": [],
                    },
                })
            else:
                # Non-trigger planning steps — already completed by _run_planning
                await agent_service.broadcast(session_id, {
                    "type": "step:running",
                    "step": step_name,
                    "progress_percent": 50,
                    "progress_message": f"规划阶段已完成: {step_name}",
                })
                await agent_service.broadcast(session_id, {
                    "type": "step:completed",
                    "step": step_name,
                    "result": {
                        "summary": f"{step_name} 完成",
                        "artifactPaths": [],
                        "previewData": None,
                        "editableFields": [],
                    },
                })

        elif phase == "rendering":
            if step_name == "character_portraits":
                # ── Trigger full rendering pipeline ─────────────────────
                request = PipelineRenderRequest(session_id=session_id)

                await agent_service.broadcast(session_id, {
                    "type": "step:running",
                    "step": step_name,
                    "progress_percent": 0,
                    "progress_message": "正在生成角色肖像...",
                })

                cancel_evt = asyncio.Event()
                await psvc._run_rendering(session_id, cancel_evt)

                # Verify rendering succeeded
                svc = get_session_service()
                session = svc.get_session(session_id)
                if session is not None and getattr(session, "stage", "") in ("error", "cancelled"):
                    error_msg = getattr(session, "error_message", "") or f"渲染失败，阶段: {session.stage}"
                    raise RuntimeError(error_msg)

                await agent_service.broadcast(session_id, {
                    "type": "step:completed",
                    "step": step_name,
                    "result": {
                        "summary": "角色肖像生成完成",
                        "artifactPaths": [],
                        "previewData": None,
                        "editableFields": [],
                    },
                })
            else:
                # video_rendering — already completed by _run_rendering
                await agent_service.broadcast(session_id, {
                    "type": "step:running",
                    "step": step_name,
                    "progress_percent": 50,
                    "progress_message": "渲染阶段已完成: video_rendering",
                })
                await agent_service.broadcast(session_id, {
                    "type": "step:completed",
                    "step": step_name,
                    "result": {
                        "summary": "视频渲染完成",
                        "artifactPaths": [],
                        "previewData": None,
                        "editableFields": [],
                    },
                })

        return {"status": "ok", "step": step_name}

    except asyncio.CancelledError:
        logger.info("Step %s cancelled for session %s", step_name, session_id)
        await agent_service.broadcast(session_id, {
            "type": "step:error",
            "step": step_name,
            "error": "步骤已取消",
            "recoverable": True,
        })
        return {"status": "error", "error": "Step cancelled"}
    except Exception as exc:
        logger.exception("Step %s failed for session %s", step_name, session_id)
        await agent_service.broadcast(session_id, {
            "type": "step:error",
            "step": step_name,
            "error": str(exc),
            "recoverable": True,
        })
        return {"status": "error", "error": str(exc)}


# ── Tool: update_artifact ───────────────────────────────────────────────

async def tool_update_artifact(
    session_id: str,
    artifact_path: str,
    content: str,
    agent_service: Any,
) -> dict[str, Any]:
    """Write or overwrite a pipeline artifact file.

    Args:
        session_id: The session identifier.
        artifact_path: Relative path under the session working dir.
        content: New content for the artifact.

    Returns:
        Dict with "status": "ok" or "error".
    """
    from web.backend.main import get_session_service
    svc = get_session_service()
    session = svc._index.get(session_id)
    if session is None:
        return {"status": "error", "error": f"Session not found: {session_id}"}
    try:
        wd = svc._index.working_dir(session_id)
        target = (wd / artifact_path).resolve()
        # Containment check: prevent path traversal
        wd_resolved = wd.resolve()
        if wd_resolved not in target.parents and target != wd_resolved:
            return {"status": "error", "error": f"Path traversal blocked: {artifact_path}"}
        # Content size limit: max 1MB
        if len(content.encode("utf-8")) > 1048576:
            return {"status": "error", "error": f"Content exceeds maximum size of 1MB: {artifact_path}"}
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return {"status": "ok", "artifact_path": artifact_path}
    except (KeyError, ValueError, OSError) as exc:
        return {"status": "error", "error": str(exc)}


# ── Tool: request_confirmation ──────────────────────────────────────────

async def tool_request_confirmation(
    session_id: str,
    prompt: str,
    agent_service: Any,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Ask the user for confirmation before proceeding.

    The Agent pauses execution and sends a confirmation request to the user
    via WebSocket.  The user must respond (confirm/modify/message) for the
    Agent to continue.

    Args:
        session_id: The session identifier.
        prompt: The confirmation question to present to the user.
        context: Optional metadata about what is being confirmed.

    Returns:
        Dict with "action": "confirm" | "modify" | "message" | "timeout",
        "payload": user-provided data, "reply": user's text reply.
    """
    gate: ConfirmationGate = agent_service._confirmation_gate

    await agent_service.broadcast(session_id, {
        "type": "agent:request_confirmation",
        "session_id": session_id,
        "prompt": prompt,
        "context": context or {},
    })

    result = await gate.wait_for_confirmation(session_id, prompt, context)
    return result


# ── Tool: navigate_to_step ──────────────────────────────────────────────

async def tool_navigate_to_step(
    session_id: str,
    step_index: int,
    agent_service: Any,
) -> dict[str, Any]:
    """Navigate the agent workflow to a specific step index.

    Args:
        session_id: The session identifier.
        step_index: 0-based step index (0=idea, 1=planning, 2=storyboard, etc.)

    Returns:
        Dict confirming navigation.
    """
    await agent_service.broadcast(session_id, {
        "type": "agent:navigate",
        "session_id": session_id,
        "step_index": step_index,
    })
    return {"status": "ok", "step_index": step_index}


# ── Step-aware suggestion options ────────────────────────────────────────

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


# ── Tool: ask_user ──────────────────────────────────────────────────────

async def tool_ask_user(
    session_id: str,
    question: str,
    agent_service: Any,
) -> str:
    """Ask the user an open-ended question and wait for a reply.

    Unlike request_confirmation, this does not imply a blocking confirmation
    gate -- the User can simply reply with text.

    Broadcasts an agent:ask event with step-aware suggestion options.

    Args:
        session_id: The session identifier.
        question: The question to ask the user.

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


# ── Tool: skip_step ─────────────────────────────────────────────────────

async def tool_skip_step(
    session_id: str,
    step_name: str,
    agent_service: Any,
) -> dict[str, Any]:
    """Skip a pipeline step and mark it as not applicable.

    Args:
        session_id: The session identifier.
        step_name: Name of the step to skip.

    Returns:
        Dict confirming the skip.
    """
    await agent_service.broadcast(session_id, {
        "type": "pipeline_status",
        "session_id": session_id,
        "stage": step_name,
        "phase": "skipped",
        "message": f"Step skipped: {step_name}",
    })
    return {"status": "ok", "step": step_name, "skipped": True}


# ── Tool: restart_workflow ──────────────────────────────────────────────

async def tool_restart_workflow(
    session_id: str,
    agent_service: Any,
) -> dict[str, Any]:
    """Restart the entire workflow from the beginning.

    Args:
        session_id: The session identifier.

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


# ── Tool registry ───────────────────────────────────────────────────────

AVAILABLE_TOOLS: dict[str, Any] = {
    "get_session_state": tool_get_session_state,
    "read_artifact": tool_read_artifact,
    "run_step": tool_run_step,
    "update_artifact": tool_update_artifact,
    "request_confirmation": tool_request_confirmation,
    "navigate_to_step": tool_navigate_to_step,
    "ask_user": tool_ask_user,
    "skip_step": tool_skip_step,
    "restart_workflow": tool_restart_workflow,
}


def build_tool_schemas() -> list[dict[str, Any]]:
    """Return JSON schema descriptions of all available tools for anthropic API."""
    return [
        {
            "name": "get_session_state",
            "description": "获取当前会话的状态，包括阶段、创意、风格和产物清单",
            "input_schema": {
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "会话标识符",
                    },
                },
                "required": ["session_id"],
            },
        },
        {
            "name": "read_artifact",
            "description": "读取会话工作目录下的产物文件内容（如 story.txt, characters.json, script.json）",
            "input_schema": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "会话标识符"},
                    "artifact_path": {
                        "type": "string",
                        "description": "产物相对路径，如 idea2video/story.txt",
                    },
                },
                "required": ["session_id", "artifact_path"],
            },
        },
        {
            "name": "run_step",
            "description": "执行一个流水线步骤（story_generation, character_extraction, script_writing, storyboard_design, character_portraits, video_rendering）",
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
                },
                "required": ["session_id", "step_name"],
            },
        },
        {
            "name": "update_artifact",
            "description": "写入或覆盖会话工作目录下的产物文件",
            "input_schema": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "会话标识符"},
                    "artifact_path": {
                        "type": "string",
                        "description": "产物相对路径",
                    },
                    "content": {"type": "string", "description": "要写入的文件内容"},
                },
                "required": ["session_id", "artifact_path", "content"],
            },
        },
        {
            "name": "request_confirmation",
            "description": "向用户请求确认。Agent暂停执行并等待用户响应后才能继续。",
            "input_schema": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "会话标识符"},
                    "prompt": {
                        "type": "string",
                        "description": "向用户展示的确认问题",
                    },
                },
                "required": ["session_id", "prompt"],
            },
        },
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
                },
                "required": ["session_id", "step_index"],
            },
        },
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
        {
            "name": "skip_step",
            "description": "跳过某个流水线步骤，标记为不适用",
            "input_schema": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "会话标识符"},
                    "step_name": {
                        "type": "string",
                        "description": "要跳过的步骤名称",
                    },
                },
                "required": ["session_id", "step_name"],
            },
        },
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
