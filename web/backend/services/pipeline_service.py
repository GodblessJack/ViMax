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
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from agent_runtime.config import (
    llm_api_key, llm_base_url, llm_model, llm_model_provider,
    image_api_key, image_base_url, image_model,
    video_api_key, video_base_url, video_model,
)
from agent_runtime.session_index import SessionIndex
# init_chat_model lazy-imported in _build_chat_model (heavy LangChain dependency)
from pipelines.idea2video_pipeline import Idea2VideoPipeline
from pipelines.script2video_pipeline import Script2VideoPipeline
from tools.image_generator_nanobanana_google_api import ImageGeneratorNanobananaGoogleAPI
from tools.image_generator_nanobanana_yunwu_api import ImageGeneratorNanobananaYunwuAPI
from tools.video_generator_omni_yunwu_api import VideoGeneratorOmniYunwuAPI
from tools.video_generator_veo_google_api import VideoGeneratorVeoGoogleAPI
from tools.video_generator_veo_yunwu_api import VideoGeneratorVeoYunwuAPI

from web.backend.config import MOCK_MODE
from web.backend.models.api_models import (
    PipelinePlanRequest, PipelineRenderRequest, PipelineStartResponse,
)

logger = logging.getLogger(__name__)


def _friendly_error(exc: Exception) -> str:
    """Convert common Python exceptions into user-friendly Chinese messages."""
    msg = str(exc)
    # RetryError / tenacity errors — API call failed after retries
    if "RetryError" in type(exc).__name__ or "RetryError" in msg:
        inner = getattr(exc, "last_attempt", None)
        if inner is not None:
            inner_exc = getattr(inner, "_exception", None) or getattr(inner, "exception", lambda: None)()
            if inner_exc is not None:
                inner_msg = str(inner_exc)[:120]
                if "ConnectionError" in type(inner_exc).__name__ or "connect" in inner_msg.lower():
                    return f"无法连接到 AI 服务，请检查网络后重试"
                if "RateLimitError" in type(inner_exc).__name__ or "rate" in inner_msg.lower() or "429" in inner_msg:
                    return f"AI 服务请求过于频繁，请稍后重试"
                if "timeout" in inner_msg.lower() or "TimedOut" in type(inner_exc).__name__:
                    return f"AI 服务响应超时，请缩短内容后重试"
                if "Auth" in type(inner_exc).__name__ or "key" in inner_msg.lower() or "401" in inner_msg or "403" in inner_msg or "无效" in inner_msg or "令牌" in inner_msg:
                    return f"AI 服务认证失败，请检查 API 密钥配置"
                return f"AI 服务调用失败: {inner_msg}"
        return "AI 服务暂时不可用，请稍后重试"

    # OpenAI / LangChain errors
    if "ClientError" in msg or "APIConnectionError" in type(exc).__name__:
        return "无法连接到 AI 服务，请检查网络后重试"
    if "RateLimitError" in type(exc).__name__ or "rate_limit" in msg.lower():
        return "AI 服务请求过于频繁，请稍后重试"
    if "AuthenticationError" in type(exc).__name__ or "auth" in msg.lower():
        return "AI 服务认证失败，请检查 API 密钥配置"
    if "timeout" in msg.lower() or "TimedOut" in type(exc).__name__:
        return "AI 服务响应超时，请缩短内容后重试"

    # Clean up memory addresses
    import re
    cleaned = re.sub(r"<[^>]*at 0x[0-9a-f]+>", "<...>", msg)
    cleaned = re.sub(r"0x[0-9a-f]+", "...", cleaned)
    return cleaned[:150]


# ── Dummy generator (reused from vimax_adapters pattern) ──────────────

class _UnavailableGenerator:
    """Placeholder generator that raises when called — used during planning
    so that no actual images/videos are created."""

    async def generate_single_image(self, *args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("Image generation is not available during planning")

    async def generate_single_video(self, *args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("Video generation is not available during planning")


# ── Output tee — preserve pipeline prints while also logging ────────────

class _TeeStream:
    """Duplicates writes to an original stream AND a delegate stream."""

    def __init__(self, original, delegate):
        self.original = original
        self.delegate = delegate

    def write(self, data: str) -> int:
        self.delegate.write(data)
        return self.original.write(data)

    def flush(self) -> None:
        self.original.flush()
        self.delegate.flush()


@contextmanager
def _capture_pipeline_output():
    """Tee stdout/stderr to log file during pipeline execution.

    Instead of discarding output (which loses diagnostics), we duplicate
    everything to ``web/logs/pipeline_run.log`` so every pipeline run is
    fully traceable.  Noisy third-party loggers are still muted.
    """
    log_dir = Path(__file__).resolve().parent.parent.parent / "logs"
    log_dir.mkdir(exist_ok=True)
    log_fh = None
    try:
        log_fh = open(log_dir / "pipeline_run.log", "a", encoding="utf-8")
        log_fh.write(
            f"\n{'='*60}\n"
            f"PIPELINE START  {datetime.now().isoformat()}\n"
            f"{'='*60}\n"
        )
        original_stdout = sys.stdout
        original_stderr = sys.stderr
        sys.stdout = _TeeStream(original_stdout, log_fh)
        sys.stderr = _TeeStream(original_stderr, log_fh)
        # Silence known noisy third-party loggers
        _muted = ["httpx", "openai", "httpcore", ""]
        _saved = {}
        for name in _muted:
            lgr = logging.getLogger(name) if name else logging.getLogger()
            _saved[name] = lgr.level
            lgr.setLevel(logging.WARNING)
        yield
    finally:
        sys.stdout = original_stdout
        sys.stderr = original_stderr
        for name, level in _saved.items():
            lgr = logging.getLogger(name) if name else logging.getLogger()
            lgr.setLevel(level)
        if log_fh is not None:
            log_fh.write(
                f"{'='*60}\n"
                f"PIPELINE END    {datetime.now().isoformat()}\n"
                f"{'='*60}\n\n"
            )
            log_fh.close()


# ── Pipeline service ─────────────────────────────────────────────────

# Timeouts for pipeline steps (seconds) — prevent indefinite hangs on LLM calls
_STEP_TIMEOUT_STORY = 600       # 10 minutes for story development (DeepSeek can be slow)
_STEP_TIMEOUT_CHARACTERS = 300  # 5 minutes for character extraction
_STEP_TIMEOUT_SCRIPT = 300      # 5 minutes for script writing
_STEP_TIMEOUT_SCENE_PLAN = 300  # 5 minutes per-scene planning (shot descriptions)
_STEP_TIMEOUT_SCENE_RENDER = 600  # 10 minutes per-scene rendering (image+video gen)

# ── Circuit breaker: prevent infinite render restarts ─────────────────
# After _CB_MAX_FAILURES failures within _CB_WINDOW_SECONDS, further
# render attempts for the same session are rejected until the window
# expires.  This stops the "fail → restart → fail" money-burning loop.
_CB_MAX_FAILURES = 3
_CB_WINDOW_SECONDS = 1800  # 30 minutes


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
        self._render_failures: dict[str, list[float]] = {}  # session_id -> [timestamps]

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

    def _build_chat_model(self, multimodal: bool = False):
        """Build a chat model. V3: uses ANTHROPIC_* env vars (DeepSeek relay)
        as primary, falling back to agent_runtime config / DashScope."""
        import os
        from langchain.chat_models import init_chat_model
        root = str(self._root)
        ds_key = os.environ.get("DASHSCOPE_API_KEY", "")

        # ── V3: Primary path — ANTHROPIC_* env vars (DeepSeek via Anthropic SDK) ─
        anthro_key = os.environ.get("ANTHROPIC_AUTH_TOKEN", "") or os.environ.get("ANTHROPIC_API_KEY", "")
        anthro_base = os.environ.get("ANTHROPIC_BASE_URL", "")
        anthro_model = os.environ.get("ANTHROPIC_MODEL", "deepseek-v4-pro[1m]")

        if anthro_key and anthro_base:
            # Use ChatAnthropic with DeepSeek relay (Anthropic-compatible)
            from langchain_anthropic import ChatAnthropic
            return ChatAnthropic(
                model=anthro_model,
                anthropic_api_key=anthro_key,
                anthropic_api_url=anthro_base,
                timeout=300,
                max_retries=0,
                max_tokens=4096,
            )

        # Rendering needs a vision-capable model (ReferenceImageSelector sends image_url)
        if multimodal and ds_key:
            return init_chat_model(
                model="qwen-plus",
                model_provider="openai",
                api_key=ds_key,
                base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
                timeout=300,
                max_retries=0,
                max_completion_tokens=4096,
            )

        api_key = llm_api_key(root)
        model = llm_model(root)
        provider = llm_model_provider(root)
        base = llm_base_url(root)

        # DashScope fallback
        if ds_key and not api_key:
            api_key = ds_key
            base = "https://dashscope.aliyuncs.com/compatible-mode/v1"
            model = "qwen-plus"
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
        """Orchestrate the full planning pipeline by delegating to sub-step methods.

        Steps: story_generation → character_extraction → script_writing →
               storyboard_design (parallel per scene)
        """
        try:
            self._session_index.update_stage(session_id, "narrative_planning", "Planning started")

            # Step 1: Story generation
            if cancel_evt.is_set():
                return
            await self._broadcast_ws(session_id, {
                "type": "pipeline_status", "session_id": session_id,
                "stage": "develop_story", "phase": "started",
                "message": "Developing story from idea...",
            })
            story_result = await self.run_story_generation(
                session_id=session_id,
                idea=request.idea,
                style=request.style,
                user_requirement=request.user_requirement,
            )

            # Step 2: Character extraction
            if cancel_evt.is_set():
                return
            await self._broadcast_ws(session_id, {
                "type": "pipeline_status", "session_id": session_id,
                "stage": "extract_characters", "phase": "started",
            })
            char_result = await self.run_character_extraction(
                session_id=session_id,
            )

            # Step 3: Script writing
            if cancel_evt.is_set():
                return
            await self._broadcast_ws(session_id, {
                "type": "pipeline_status", "session_id": session_id,
                "stage": "write_script", "phase": "started",
            })
            script_result = await self.run_script_writing(
                session_id=session_id,
                user_requirement=request.user_requirement,
            )
            scene_scripts = script_result.get("scene_scripts", [])

            # Step 4: Storyboard design per scene (parallel — scenes are independent)
            async def _plan_scene(idx: int):
                if cancel_evt.is_set():
                    return None
                await self._broadcast_ws(session_id, {
                    "type": "pipeline_status", "session_id": session_id,
                    "stage": f"plan_scene_{idx}", "phase": "started",
                    "message": f"Planning scene {idx + 1}/{len(scene_scripts)}...",
                })
                await self.run_storyboard_scene(
                    session_id=session_id,
                    scene_index=idx,
                    user_requirement=request.user_requirement,
                    style=request.style,
                )
                return idx

            if not cancel_evt.is_set():
                await asyncio.gather(*[_plan_scene(i) for i in range(len(scene_scripts))])

            self._session_index.update_stage(session_id, "narrative_planned", "Planning complete")
            await self._broadcast_ws(session_id, {
                "type": "pipeline:complete", "session_id": session_id,
                "stage": "narrative_planned",
                "message": "Planning complete. Ready for rendering.",
            })

        except asyncio.CancelledError:
            self._session_index.update_stage(session_id, "cancelled", "Planning cancelled")
            await self._broadcast_ws(session_id, {
                "type": "pipeline_error", "session_id": session_id,
                "error": "Planning was cancelled",
            })
        except asyncio.TimeoutError:
            if MOCK_MODE:
                logger.warning("Planning timed out for session %s — falling back to mock data", session_id)
                await self._generate_mock_planning(session_id, request.idea, request.style)
            else:
                logger.exception("Planning timed out for session %s", session_id)
                friendly = "规划超时 — AI 服务响应过慢，请重试或缩短创意描述"
                self._session_index.update_stage(session_id, "error", friendly)
                await self._broadcast_ws(session_id, {
                    "type": "pipeline_error", "session_id": session_id,
                    "error": friendly,
                })
        except Exception as exc:
            if MOCK_MODE:
                logger.warning("Planning failed for session %s — falling back to mock data: %s", session_id, exc)
                await self._generate_mock_planning(session_id, request.idea, request.style)
            else:
                logger.exception("Planning failed for session %s", session_id)
                friendly = f"规划失败: {_friendly_error(exc)}"
                self._session_index.update_stage(session_id, "error", friendly)
                await self._broadcast_ws(session_id, {
                    "type": "pipeline_error", "session_id": session_id,
                    "error": friendly,
                })

    async def _generate_mock_planning(self, session_id: str, idea: str, style: str) -> None:
        """Generate rich mock planning data when LLM is unavailable.

        Creates story, characters, script, and storyboard artifacts in the
        session working directory and broadcasts progress events to mimic the
        real pipeline flow.
        """
        import json as json_mod

        working_dir = str(self._session_index.working_dir(session_id) / "idea2video")
        os.makedirs(working_dir, exist_ok=True)

        logger.info("Generating mock planning data for session %s (idea=%r, style=%r)",
                    session_id, idea, style)

        # ── 1. Story ──────────────────────────────────────────────────
        style_desc = style or "wuxia"
        idea_text = idea or "一个关于江湖恩怨与侠义精神的传奇故事"

        story = f"""第一章 月下孤影

夜，深沉如墨。一轮冷月高悬天际，清辉洒落，将整座青云山笼罩在一片幽蓝之中。

山腰处的竹林间，一个白衣少年持剑而立。他名叫{idea_text[:20]}，自幼在师父门下习武，如今已是弱冠之年。今夜，是他首次独自下山的前夕。

少年手中的长剑泛着淡淡的青光，剑身上刻着「{idea_text[:10] or style_desc}」三个古字，那是师父临终前交予他的遗物。每当月华映照剑身，便会浮现出若隐若现的纹路，仿佛在诉说着一个尘封已久的秘密。

「明日下山，切记：江湖险恶，人心叵测。」师父的话语犹在耳畔。

少年深吸一口气，目光穿过层层竹影，望向山脚下那座灯火阑珊的城池。他知道，在那座城中，有着关于他身世的线索，也有着一段未了的恩怨。

第二章 城中风波

翌日清晨，少年踏入了繁华的洛水城。

青石板铺就的街道两旁，商铺林立，人声鼎沸。卖艺的、杂耍的、说书的、算卦的……三教九流汇聚一处，好不热闹。少年自幼长于深山，哪见过这等景象，不禁看得有些眼花缭乱。

正行间，忽听得前方传来一阵打斗之声。

少年快步上前，只见六七名黑衣壮汉正围着一个绿衫女子疯狂进击。那女子虽武艺不弱，但寡不敌众，已是左支右绌，眼看就要受伤。

少年心中一凛，右手已按在了剑柄之上。

「住手！」他一声断喝，人随声至，一道青芒闪过，已将两名黑衣人的兵器齐齐削断。

那绿衫女子趁机一个翻身，退到少年身侧，低声说道：「多谢相救。这些人是铁剑门的人，你……你不该管这闲事的。」

少年微微一笑：「路见不平，拔刀相助，本是习武之人该做的事。」

第三章 宿命之约

黑衣人被少年一招镇住，为首之人冷声道：「小子，我劝你不要多管闲事，否则……」他话未说完，突然脸色大变，目光死死盯着少年手中那柄泛着青光的长剑。

「……青冥剑！」黑衣人的声音带着颤抖，「你……你是那个人的徒弟？」

少年眉头一皱：「你知道我师父？」

黑衣人后退两步，从怀中掏出一支信号箭，朝天射去。只听一声尖啸，一道红光在半空中炸开。

绿衫女子脸色大变：「不好，他们在叫援兵！我们快走！」

两人足尖一点，跃上房顶，几个起落便消失在街巷深处。

在绿衫女子的带领下，少年穿过了无数条狭窄的巷道，最终来到了一处僻静的院落。院中有一株百年老槐树，枝繁叶茂，遮天蔽日。

「你先在这里避一避。」绿衫女子喘息着说道，「我叫柳如烟，多谢恩公适才出手。敢问恩公高姓大名？」

少年正欲回答，却听得院门外传来一阵沉稳的脚步声。

一个白发苍苍的老者缓步走了进来，目光落在少年手中的青冥剑上，眼中闪过一丝复杂的光芒。

「二十年了……青冥剑终于重现江湖。」老者长叹一声，「孩子，你的师父……他还好吗？」

少年心中巨震，脱口道：「师父已经仙逝了。您……您认识他？」

老者的眼中掠过一抹深沉的悲恸，缓缓说道：「岂止认识。这柄青冥剑，原本是两个人的佩剑。一柄在你师父手中，另一柄……」他顿了顿，从怀中取出一柄形状一模一样的剑，只是颜色暗沉，如同深渊。

「在我这里。」

这一刻，月光透过槐树的枝叶洒落，两柄剑在清辉中互相辉映，仿佛在述说着一段横跨二十年的江湖往事。

（全文完）"""

        story_path = os.path.join(working_dir, "story.txt")
        with open(story_path, "w", encoding="utf-8") as f:
            f.write(story)

        await self._broadcast_ws(session_id, {
            "type": "artifact_ready", "session_id": session_id,
            "path": "idea2video/story.txt",
            "url": f"/api/files/{session_id}/idea2video/story.txt",
        })

        # ── 2. Characters (must match CharacterInScene schema) ─────────
        characters = [
            {
                "idx": 0,
                "identifier_in_scene": "林风",
                "is_visible": True,
                "static_features": "约二十岁，身着白色长袍，长发束冠，面容清俊，眼神中透着坚毅与些许迷茫 — 白衣少年侠客，手持师父遗留的青冥剑",
                "dynamic_features": "正义感强烈，心地纯善但不失机敏，面对强敌时冷静沉着，白色长袍随身形飘动",
            },
            {
                "idx": 1,
                "identifier_in_scene": "柳如烟",
                "is_visible": True,
                "static_features": "约十八九岁，身着翠绿色纱裙，容貌秀丽，柳眉皓齿，手持银针为武器 — 出身医药世家的绿衫女子",
                "dynamic_features": "外冷内热，警惕性高，因家族变故而对人充满戒备，翠绿纱裙轻盈飘逸",
            },
            {
                "idx": 2,
                "identifier_in_scene": "铁无痕",
                "is_visible": True,
                "static_features": "约五十余岁，身材魁梧，面目威严，双手布满老茧，一双鹰目令人不寒而栗 — 铁剑门掌门",
                "dynamic_features": "野心勃勃，城府极深，为达目的不惜一切手段，身着重甲气势逼人",
            },
            {
                "idx": 3,
                "identifier_in_scene": "白云道长",
                "is_visible": True,
                "static_features": "约七十余岁，白发白须，仙风道骨，手持拂尘，身着灰色道袍 — 隐居深山的得道高人",
                "dynamic_features": "看透世事，言语玄奥，关键时刻指点迷津，拂尘轻挥仙气缭绕",
            },
        ]

        chars_path = os.path.join(working_dir, "characters.json")
        with open(chars_path, "w", encoding="utf-8") as f:
            json_mod.dump(characters, f, ensure_ascii=False, indent=2)

        await self._broadcast_ws(session_id, {
            "type": "artifact_ready", "session_id": session_id,
            "path": "idea2video/characters.json",
            "url": f"/api/files/{session_id}/idea2video/characters.json",
        })

        # ── 3. Script ──────────────────────────────────────────────────
        script = [
            {
                "scene_number": 0,
                "title": "月下初遇",
                "description": f"月夜竹林，主角林风持{style_desc}风格的青冥剑静立，回忆师父遗训，准备下山。",
                "shots": 4,
                "location": "青云山竹林",
                "time_of_day": "深夜",
                "mood": "静谧、神秘、期待",
                "characters": ["林风"],
            },
            {
                "scene_number": 1,
                "title": "城中风波",
                "description": "林风初入洛水城，目睹柳如烟被黑衣人围攻，拔剑相助，青冥剑首次显露。",
                "shots": 5,
                "location": "洛水城街道",
                "time_of_day": "正午",
                "mood": "热闹、紧张、激烈",
                "characters": ["林风", "柳如烟", "铁无痕手下"],
            },
            {
                "scene_number": 2,
                "title": "宿命之约",
                "description": "在隐秘院落中，白云道长揭示青冥剑的秘密，二十年前的恩怨浮出水面。",
                "shots": 4,
                "location": "隐秘院落",
                "time_of_day": "黄昏",
                "mood": "沉重、揭示、宿命",
                "characters": ["林风", "柳如烟", "白云道长"],
            },
        ]

        script_path = os.path.join(working_dir, "script.json")
        with open(script_path, "w", encoding="utf-8") as f:
            json_mod.dump(script, f, ensure_ascii=False, indent=2)

        await self._broadcast_ws(session_id, {
            "type": "artifact_ready", "session_id": session_id,
            "path": "idea2video/script.json",
            "url": f"/api/files/{session_id}/idea2video/script.json",
        })

        # ── 4. Storyboard for scene_0 ──────────────────────────────────
        scene_dir = os.path.join(working_dir, "scene_0")
        os.makedirs(scene_dir, exist_ok=True)

        storyboard = [
            {
                "shot_number": 1,
                "visual_description": "夜空之下，一轮冷月高悬。镜头从月亮缓缓下移，穿过夜雾，落在青云山竹林间。白色身影持剑静立，衣袂在夜风中轻轻飘动。",
                "camera_angle": "远景，自上而下摇镜",
                "duration": 6.0,
                "action": "环境建立，引入主角",
            },
            {
                "shot_number": 2,
                "visual_description": "镜头缓缓推近主角面部。月光照亮他清俊的脸庞，眼神中混合着坚毅与迷惘。他低头看着手中的青冥剑，剑身在月华下泛起淡淡的幽光。",
                "camera_angle": "中景转特写，缓慢推镜",
                "duration": 5.0,
                "action": "展现主角内心情感",
            },
            {
                "shot_number": 3,
                "visual_description": "一个柔和的叠化转场。少年脑中浮现师父临终时的画面——苍老的手将青冥剑交到他手中。幻象与现实的叠加表现回忆。",
                "camera_angle": "特写+叠化特效",
                "duration": 4.0,
                "action": "回忆闪回",
            },
            {
                "shot_number": 4,
                "visual_description": "回到现实。少年深吸一口气，目光穿过层层竹影，望向山脚下灯火阑珊的城池。镜头跟随他的视线拉远，展现远处城池的全景。",
                "camera_angle": "远景，主观视角转全景",
                "duration": 5.0,
                "action": "主角下定决心，引出下一场景",
            },
        ]

        sb_path = os.path.join(scene_dir, "storyboard.json")
        with open(sb_path, "w", encoding="utf-8") as f:
            json_mod.dump(storyboard, f, ensure_ascii=False, indent=2)

        await self._broadcast_ws(session_id, {
            "type": "artifact_ready", "session_id": session_id,
            "path": "idea2video/scene_0/storyboard.json",
            "url": f"/api/files/{session_id}/idea2video/scene_0/storyboard.json",
        })

        # ── Mark planning complete ─────────────────────────────────────
        self._session_index.update_stage(session_id, "narrative_planned", "Planning complete (mock)")

        await self._broadcast_ws(session_id, {
            "type": "pipeline:complete", "session_id": session_id,
            "stage": "narrative_planned",
            "message": "Planning complete. Ready for rendering.",
        })

        logger.info("Mock planning data generated successfully for session %s", session_id)

    # ── Public API: start rendering ───────────────────────────────────

    async def start_rendering(
        self,
        request: PipelineRenderRequest,
    ) -> PipelineStartResponse:
        session_id = request.session_id

        # ── Circuit breaker: reject if too many recent failures ──────────
        now = time.time()
        timestamps = self._render_failures.get(session_id, [])
        # Purge expired entries
        timestamps = [t for t in timestamps if now - t < _CB_WINDOW_SECONDS]
        self._render_failures[session_id] = timestamps
        if len(timestamps) >= _CB_MAX_FAILURES:
            wait_m = round((_CB_WINDOW_SECONDS - (now - timestamps[0])) / 60)
            msg = (
                f"渲染已连续失败 {len(timestamps)} 次，已触发熔断保护。"
                f"请等待约 {wait_m} 分钟后再试，或使用新的 session。"
            )
            logger.warning("Circuit breaker open for session %s (%d failures in %ds window)",
                           session_id, len(timestamps), _CB_WINDOW_SECONDS)
            raise ValueError(msg)

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
        """Orchestrate the full rendering pipeline by delegating to sub-step methods.

        Steps: character_portraits → video_rendering (all scenes).
        """
        try:
            self._session_index.update_stage(session_id, "rendering", "Rendering started")

            # Step 5: Character portraits (all characters)
            if cancel_evt.is_set():
                return
            await self._broadcast_ws(session_id, {
                "type": "pipeline_status", "session_id": session_id,
                "stage": "character_portraits", "phase": "started",
                "message": "Generating character portraits...",
            })
            portrait_result = await self.run_character_portrait(
                session_id=session_id,
            )

            if cancel_evt.is_set():
                return

            # Step 6: Video rendering (all scenes)
            await self._broadcast_ws(session_id, {
                "type": "pipeline_status", "session_id": session_id,
                "stage": "render_scenes", "phase": "started",
                "message": "Rendering all scenes...",
            })
            video_result = await self.run_video_scene(
                session_id=session_id,
            )

            # Final status check
            final_url = video_result.get("final_video_url")
            if final_url:
                self._session_index.update_stage(session_id, "rendered", "Rendering complete")
                await self._broadcast_ws(session_id, {
                    "type": "pipeline:complete", "session_id": session_id,
                    "stage": "rendered",
                    "final_video_url": final_url,
                })
            else:
                self._session_index.update_stage(session_id, "rendered", "Rendering complete (no concat)")

            # Rendering succeeded — clear circuit-breaker failure history
            self._render_failures.pop(session_id, None)

        except asyncio.CancelledError:
            self._session_index.update_stage(session_id, "cancelled", "Rendering cancelled")
            await self._broadcast_ws(session_id, {
                "type": "pipeline_error", "session_id": session_id,
                "error": "Rendering was cancelled",
            })
        except asyncio.TimeoutError:
            if MOCK_MODE:
                logger.warning("Rendering timed out for session %s — falling back to mock data", session_id)
                await self._generate_mock_rendering(session_id)
                return
            self._record_render_failure(session_id)
            logger.exception("Rendering timed out for session %s", session_id)
            friendly = "渲染超时 — AI 服务响应过慢，请重试或减少镜头数"
            self._session_index.update_stage(session_id, "error", friendly)
            await self._broadcast_ws(session_id, {
                "type": "pipeline_error", "session_id": session_id,
                "error": friendly,
            })
        except Exception as exc:
            if MOCK_MODE:
                logger.warning("Rendering failed for session %s — falling back to mock data: %s", session_id, exc)
                await self._generate_mock_rendering(session_id)
                return
            self._record_render_failure(session_id)
            logger.exception("Rendering failed for session %s", session_id)
            friendly = f"渲染失败: {_friendly_error(exc)}"
            self._session_index.update_stage(session_id, "error", friendly)
            await self._broadcast_ws(session_id, {
                "type": "pipeline_error", "session_id": session_id,
                "error": friendly,
            })

    # ── V3 Public sub-step methods ──────────────────────────────────────

    async def run_story_generation(
        self,
        session_id: str,
        idea: str,
        style: str,
        user_requirement: str = "",
        progress_callback: Callable | None = None,
    ) -> dict[str, Any]:
        """Execute ONLY story generation. Does NOT run subsequent steps.

        Broadcasts step:running with granular progress and artifact_ready
        when the story file is written.

        Returns:
            {"status": "ok", "artifacts": ["idea2video/story.txt"], "story": "..."}
        """
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

        await self._broadcast_ws(session_id, {
            "type": "step:running",
            "step": "story_generation",
            "progress_percent": 10,
            "progress_message": "正在构思故事...",
        })

        with _capture_pipeline_output():
            story = await asyncio.wait_for(
                pipeline.develop_story(
                    idea=idea,
                    user_requirement=user_requirement,
                    quiet=True,
                ),
                timeout=_STEP_TIMEOUT_STORY,
            )

        await self._broadcast_ws(session_id, {
            "type": "step:running",
            "step": "story_generation",
            "progress_percent": 90,
            "progress_message": "故事生成完毕，正在保存...",
        })

        await self._broadcast_ws(session_id, {
            "type": "artifact_ready",
            "session_id": session_id,
            "path": "idea2video/story.txt",
            "url": f"/api/files/{session_id}/idea2video/story.txt",
        })

        return {
            "status": "ok",
            "artifacts": ["idea2video/story.txt"],
            "story": story,
        }

    async def run_character_extraction(
        self,
        session_id: str,
        progress_callback: Callable | None = None,
    ) -> dict[str, Any]:
        """Execute ONLY character extraction. Reads story.txt from working dir.

        Broadcasts step:running with granular progress and artifact_ready
        when the characters file is written.

        Returns:
            {"status": "ok", "artifacts": ["idea2video/characters.json"], "characters": [...]}
        """
        working_dir = str(self._session_index.working_dir(session_id) / "idea2video")
        story_path = os.path.join(working_dir, "story.txt")
        if not os.path.exists(story_path):
            raise FileNotFoundError(
                f"story.txt not found — run story_generation first"
            )
        with open(story_path, "r", encoding="utf-8") as f:
            story = f.read()

        chat_model = self._build_chat_model()
        dummy = _UnavailableGenerator()
        pipeline = Idea2VideoPipeline(
            chat_model=chat_model,
            image_generator=dummy,
            video_generator=dummy,
            working_dir=working_dir,
        )

        await self._broadcast_ws(session_id, {
            "type": "step:running",
            "step": "character_extraction",
            "progress_percent": 10,
            "progress_message": "正在提取角色...",
        })

        with _capture_pipeline_output():
            characters = await asyncio.wait_for(
                pipeline.extract_characters(story=story, quiet=True),
                timeout=_STEP_TIMEOUT_CHARACTERS,
            )

        await self._broadcast_ws(session_id, {
            "type": "artifact_ready",
            "session_id": session_id,
            "path": "idea2video/characters.json",
            "url": f"/api/files/{session_id}/idea2video/characters.json",
        })

        return {
            "status": "ok",
            "artifacts": ["idea2video/characters.json"],
            "characters": characters,
        }

    async def run_script_writing(
        self,
        session_id: str,
        user_requirement: str = "",
        progress_callback: Callable | None = None,
    ) -> dict[str, Any]:
        """Execute ONLY script writing. Reads story.txt from working dir.

        Broadcasts step:running with granular progress and artifact_ready
        when the script file is written.

        Returns:
            {"status": "ok", "artifacts": ["idea2video/script.json"], "scene_scripts": [...]}
        """
        working_dir = str(self._session_index.working_dir(session_id) / "idea2video")
        story_path = os.path.join(working_dir, "story.txt")
        if not os.path.exists(story_path):
            raise FileNotFoundError(
                f"story.txt not found — run story_generation first"
            )
        with open(story_path, "r", encoding="utf-8") as f:
            story = f.read()

        chat_model = self._build_chat_model()
        dummy = _UnavailableGenerator()
        pipeline = Idea2VideoPipeline(
            chat_model=chat_model,
            image_generator=dummy,
            video_generator=dummy,
            working_dir=working_dir,
        )

        await self._broadcast_ws(session_id, {
            "type": "step:running",
            "step": "script_writing",
            "progress_percent": 10,
            "progress_message": "正在编写剧本...",
        })

        with _capture_pipeline_output():
            scene_scripts = await asyncio.wait_for(
                pipeline.write_script_based_on_story(
                    story=story,
                    user_requirement=user_requirement,
                    quiet=True,
                ),
                timeout=_STEP_TIMEOUT_SCRIPT,
            )

        await self._broadcast_ws(session_id, {
            "type": "artifact_ready",
            "session_id": session_id,
            "path": "idea2video/script.json",
            "url": f"/api/files/{session_id}/idea2video/script.json",
        })

        return {
            "status": "ok",
            "artifacts": ["idea2video/script.json"],
            "scene_scripts": scene_scripts,
        }

    async def run_storyboard_scene(
        self,
        session_id: str,
        scene_index: int,
        user_requirement: str = "",
        style: str = "",
        progress_callback: Callable | None = None,
    ) -> dict[str, Any]:
        """Execute storyboard design for a SINGLE scene.

        Reads script.json and characters.json from the working directory
        and produces the storyboard artifact for the specified scene.

        Broadcasts step:running with per-scene progress and artifact_ready.

        Returns:
            {"status": "ok", "artifacts": ["idea2video/scene_N/storyboard.json"], "scene_index": N}
        """
        working_dir = str(self._session_index.working_dir(session_id) / "idea2video")

        # Load scene script for the requested index
        script_path = os.path.join(working_dir, "script.json")
        if not os.path.exists(script_path):
            raise FileNotFoundError(
                f"script.json not found — run script_writing first"
            )
        with open(script_path, "r", encoding="utf-8") as f:
            scene_scripts = json.load(f)

        if not isinstance(scene_scripts, list) or scene_index >= len(scene_scripts):
            raise ValueError(
                f"Scene index {scene_index} out of range "
                f"(0-{len(scene_scripts) - 1 if isinstance(scene_scripts, list) else 0})"
            )

        scene_script = scene_scripts[scene_index]
        total_scenes = len(scene_scripts)

        # Load characters
        chars_path = os.path.join(working_dir, "characters.json")
        characters = []
        if os.path.exists(chars_path):
            with open(chars_path, "r", encoding="utf-8") as f:
                characters = json.load(f)

        scene_dir = os.path.join(working_dir, f"scene_{scene_index}")
        os.makedirs(scene_dir, exist_ok=True)

        chat_model = self._build_chat_model()
        dummy = _UnavailableGenerator()

        script_text = (
            json.dumps(scene_script) if isinstance(scene_script, dict)
            else str(scene_script)
        )

        sp = Script2VideoPipeline(
            chat_model=chat_model,
            image_generator=dummy,
            video_generator=dummy,
            working_dir=scene_dir,
        )

        await self._broadcast_ws(session_id, {
            "type": "step:running",
            "step": "storyboard_design",
            "progress_percent": int((scene_index + 1) / total_scenes * 100),
            "progress_message": (
                f"正在设计场景 {scene_index + 1}/{total_scenes} 的分镜..."
            ),
        })

        with _capture_pipeline_output():
            await asyncio.wait_for(
                sp.plan_text_artifacts(
                    script=script_text,
                    user_requirement=user_requirement,
                    style=style,
                    characters=characters,
                    progress=self._ws_progress_callback(session_id),
                    quiet=True,
                ),
                timeout=_STEP_TIMEOUT_SCENE_PLAN,
            )

        await self._broadcast_ws(session_id, {
            "type": "artifact_ready",
            "session_id": session_id,
            "path": f"idea2video/scene_{scene_index}/storyboard.json",
            "url": f"/api/files/{session_id}/idea2video/scene_{scene_index}/storyboard.json",
        })

        return {
            "status": "ok",
            "artifacts": [f"idea2video/scene_{scene_index}/storyboard.json"],
            "scene_index": scene_index,
        }

    async def run_character_portrait(
        self,
        session_id: str,
        character_index: int | None = None,
        progress_callback: Callable | None = None,
    ) -> dict[str, Any]:
        """Generate character portraits.

        If character_index is None: generate ALL characters.
        If character_index is provided: generate ONLY that character.

        Broadcasts step:running with granular progress and per-character
        render_progress events for each generated portrait view.

        Returns:
            {"status": "ok", "portraits": [{"character_name": ..., "character_id": ...}, ...]}
        """
        working_dir = str(self._session_index.working_dir(session_id) / "idea2video")

        # Load characters
        chars_path = os.path.join(working_dir, "characters.json")
        if not os.path.exists(chars_path):
            raise FileNotFoundError(
                f"characters.json not found — run planning first"
            )
        with open(chars_path, "r", encoding="utf-8") as f:
            characters_data = json.load(f)

        from interfaces.character import CharacterInScene
        all_characters = [CharacterInScene.model_validate(c) for c in characters_data]

        if character_index is not None:
            if character_index >= len(all_characters):
                raise ValueError(
                    f"Character index {character_index} out of range "
                    f"(0-{len(all_characters) - 1})"
                )
            characters = [all_characters[character_index]]
        else:
            characters = all_characters

        chat_model = self._build_chat_model(multimodal=True)
        image_gen = self._build_image_generator()
        video_gen = self._build_video_generator()

        pipeline = Idea2VideoPipeline(
            chat_model=chat_model,
            image_generator=image_gen,
            video_generator=video_gen,
            working_dir=working_dir,
        )

        session = self._session_index.get(session_id)
        style_val = (session or {}).get("style", "")

        await self._broadcast_ws(session_id, {
            "type": "step:running",
            "step": "character_portraits",
            "progress_percent": 10,
            "progress_message": (
                f"正在为 {len(characters)} 个角色生成肖像..."
            ),
        })

        with _capture_pipeline_output():
            character_portraits_registry = await asyncio.wait_for(
                pipeline.generate_character_portraits(
                    characters=characters,
                    character_portraits_registry=None,
                    style=style_val,
                ),
                timeout=_STEP_TIMEOUT_CHARACTERS,
            )

        # Broadcast per-character portrait images
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
                        "image_url": (
                            f"/api/files/{session_id}/idea2video/"
                            f"character_portraits/{c.idx}_"
                            f"{c.identifier_in_scene or 'unknown'}/{view}.png"
                        ),
                    })

        return {
            "status": "ok",
            "portraits": [
                {
                    "character_name": c.identifier_in_scene,
                    "character_id": c.idx,
                }
                for c in characters
            ],
        }

    async def run_video_scene(
        self,
        session_id: str,
        scene_index: int | None = None,
        progress_callback: Callable | None = None,
    ) -> dict[str, Any]:
        """Render video for one or all scenes.

        If scene_index is None: render ALL scenes sequentially.
        If scene_index is provided: render ONLY that scene.

        Broadcasts step:running with per-scene granular progress.

        Returns:
            {"status": "ok", "scenes_rendered": [0, 1, ...], "final_video_url": "..."}
        """
        working_dir = str(self._session_index.working_dir(session_id) / "idea2video")

        # Load scene scripts
        script_path = os.path.join(working_dir, "script.json")
        if not os.path.exists(script_path):
            raise FileNotFoundError(
                f"script.json not found — run planning first"
            )
        with open(script_path, "r", encoding="utf-8") as f:
            scene_scripts = json.load(f)

        # Load characters
        chars_path = os.path.join(working_dir, "characters.json")
        with open(chars_path, "r", encoding="utf-8") as f:
            characters_data = json.load(f)

        from interfaces.character import CharacterInScene
        characters = [CharacterInScene.model_validate(c) for c in characters_data]

        chat_model = self._build_chat_model(multimodal=True)
        image_gen = self._build_image_generator()
        video_gen = self._build_video_generator()

        session_data = self._session_index.get(session_id) or {}
        user_req = session_data.get("user_requirement", "")
        style_val = session_data.get("style", "")

        if scene_index is not None:
            indices = [scene_index]
        else:
            indices = list(range(len(scene_scripts)))

        rendered = []
        for idx in indices:
            if idx >= len(scene_scripts):
                continue
            scene_script = scene_scripts[idx]
            scene_dir = os.path.join(working_dir, f"scene_{idx}")
            os.makedirs(scene_dir, exist_ok=True)

            script_text = (
                json.dumps(scene_script) if isinstance(scene_script, dict)
                else str(scene_script)
            )

            sp = Script2VideoPipeline(
                chat_model=chat_model,
                image_generator=image_gen,
                video_generator=video_gen,
                working_dir=scene_dir,
            )

            await self._broadcast_ws(session_id, {
                "type": "step:running",
                "step": "video_rendering",
                "progress_percent": int((idx + 1) / len(indices) * 100),
                "progress_message": (
                    f"正在渲染场景 {idx + 1}/{len(indices)}..."
                ),
            })

            with _capture_pipeline_output():
                await asyncio.wait_for(
                    sp(
                        script=script_text,
                        user_requirement=user_req,
                        style=style_val,
                        characters=characters,
                        character_portraits_registry=None,
                        progress=self._ws_progress_callback(session_id),
                        quiet=True,
                    ),
                    timeout=_STEP_TIMEOUT_SCENE_RENDER,
                )
            rendered.append(idx)

        # Check for final video
        final_video_url = None
        final_path = os.path.join(working_dir, "final_video.mp4")
        if os.path.exists(final_path):
            final_video_url = f"/api/files/{session_id}/idea2video/final_video.mp4"
        else:
            scene0_video = os.path.join(working_dir, "scene_0", "final_video.mp4")
            if os.path.exists(scene0_video):
                final_video_url = (
                    f"/api/files/{session_id}/idea2video/scene_0/final_video.mp4"
                )

        return {
            "status": "ok",
            "scenes_rendered": rendered,
            "final_video_url": final_video_url,
        }

    # ── V3 Public API: generic step dispatch ────────────────────────────

    async def run_step(
        self,
        session_id: str,
        step_name: str,
        params: dict[str, Any] | None = None,
        cancel_evt: asyncio.Event | None = None,
    ) -> dict[str, Any]:
        """Generic step execution dispatcher.

        Routes to the appropriate per-step method based on step_name.
        For multi-scene steps (storyboard_design, video_rendering), iterates
        over sub-scenes.

        Args:
            session_id: The session to run the step for.
            step_name: Machine step name (e.g. "story_generation").
            params: Optional parameters dict (idea, style, user_requirement, etc.).
            cancel_evt: Optional asyncio.Event to signal cancellation.

        Returns:
            {"status": "ok" | "error", "artifacts": [...], "result": ...}
        """
        p = params or {}
        idx = self._session_index or None

        if idx is not None:
            wd = idx.working_dir(session_id)
            idea = p.get("idea", "") or (idx.get(session_id) or {}).get("idea", "")
            style = p.get("style", "") or (idx.get(session_id) or {}).get("style", "wuxia")
            user_requirement = p.get("user_requirement", "") or (idx.get(session_id) or {}).get("user_requirement", "")
        else:
            wd = None
            idea = p.get("idea", "")
            style = p.get("style", "wuxia")
            user_requirement = p.get("user_requirement", "")

        try:
            if step_name == "story_generation":
                result = await self.run_story_generation(
                    session_id, idea=idea, style=style,
                    user_requirement=user_requirement,
                )
                return {"status": "ok", "artifacts": result.get("artifacts", []), "result": result}

            elif step_name == "character_extraction":
                result = await self.run_character_extraction(session_id)
                return {"status": "ok", "artifacts": result.get("artifacts", []), "result": result}

            elif step_name == "script_writing":
                result = await self.run_script_writing(session_id)
                return {"status": "ok", "artifacts": result.get("artifacts", []), "result": result}

            elif step_name == "storyboard_design":
                scenes = p.get("scenes", [])
                if not scenes:
                    # Read scenes from script.json if not provided
                    script_path = wd / "idea2video" / "script.json" if wd else None
                    if script_path and script_path.exists():
                        try:
                            script_data = json.loads(script_path.read_text("utf-8"))
                            scenes = script_data if isinstance(script_data, list) else script_data.get("scenes", [])
                        except Exception:
                            scenes = [{"index": 0}, {"index": 1}, {"index": 2}]
                    else:
                        scenes = [{"index": 0}, {"index": 1}, {"index": 2}]
                results = []
                for scene in scenes:
                    if cancel_evt and cancel_evt.is_set():
                        return {"status": "cancelled", "artifacts": [], "result": {}}
                    scene_idx = scene.get("index", scene.get("idx", 0)) if isinstance(scene, dict) else scene
                    r = await self.run_storyboard_scene(session_id, scene_idx=scene_idx)
                    results.append(r)
                return {"status": "ok", "artifacts": [r.get("artifacts", []) for r in results], "result": results}

            elif step_name == "character_portraits":
                result = await self.run_character_portrait(session_id)
                return {"status": "ok", "artifacts": result.get("artifacts", []), "result": result}

            elif step_name == "video_rendering":
                scenes = p.get("scenes", [])
                if not scenes:
                    script_path = wd / "idea2video" / "script.json" if wd else None
                    if script_path and script_path.exists():
                        try:
                            script_data = json.loads(script_path.read_text("utf-8"))
                            scenes = script_data if isinstance(script_data, list) else script_data.get("scenes", [])
                        except Exception:
                            scenes = [{"index": 0}, {"index": 1}, {"index": 2}]
                    else:
                        scenes = [{"index": 0}, {"index": 1}, {"index": 2}]
                results = []
                for scene in scenes:
                    if cancel_evt and cancel_evt.is_set():
                        return {"status": "cancelled", "artifacts": [], "result": {}}
                    scene_idx = scene.get("index", scene.get("idx", 0)) if isinstance(scene, dict) else scene
                    r = await self.run_video_scene(session_id, scene_idx=scene_idx)
                    results.append(r)
                return {"status": "ok", "artifacts": [r.get("artifacts", []) for r in results], "result": results}

            else:
                return {"status": "error", "error": f"Unknown step name: {step_name}"}

        except asyncio.CancelledError:
            return {"status": "cancelled", "error": "Step cancelled"}
        except Exception as exc:
            logger.exception("run_step failed for session %s step %s", session_id, step_name)
            return {"status": "error", "error": _friendly_error(exc)}

    # ── V3 Public API: artifact modification ──────────────────────────

    def modify_artifact(
        self,
        session_id: str,
        artifact_path: str,
        content: Any,
    ) -> dict[str, Any]:
        """Modify an artifact file in the session working directory.

        Generates a diff between old and new content, writes the new file,
        and returns the diff for downstream broadcasting.

        Args:
            session_id: The session whose artifact to modify.
            artifact_path: Relative path within the session (e.g. "idea2video/story.txt").
            content: New content to write (str for text, dict for JSON).

        Returns:
            {"status": "ok", "artifact_path": ..., "old_content": ..., "new_content": ..., "diff": "..."}
        """
        wd = self._session_index.working_dir(session_id)
        file_path = wd / artifact_path

        # Read old content
        old_content: str | None = None
        if file_path.exists():
            try:
                old_content = file_path.read_text(encoding="utf-8")
            except Exception:
                old_content = None

        # Serialize new content
        if isinstance(content, str):
            new_content = content
        elif isinstance(content, (dict, list)):
            new_content = json.dumps(content, ensure_ascii=False, indent=2)
        else:
            new_content = str(content)

        # Generate diff
        diff_text = ""
        if old_content is not None:
            import difflib
            diff_lines = list(difflib.unified_diff(
                old_content.splitlines(keepends=True),
                new_content.splitlines(keepends=True),
                fromfile=f"a/{artifact_path}",
                tofile=f"b/{artifact_path}",
            ))
            diff_text = "".join(diff_lines)

        # Write new file
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(new_content, encoding="utf-8")

        return {
            "status": "ok",
            "artifact_path": artifact_path,
            "old_content": old_content,
            "new_content": new_content,
            "diff": diff_text,
        }

    # ── V3 Public API: pipeline introspection ─────────────────────────

    def inspect_pipeline(self, session_id: str) -> dict[str, Any]:
        """Return detailed pipeline progress and sub-step status.

        Returns:
            {
                "session_id": str,
                "stage": str,
                "completed_steps": [...],
                "current_step": str | None,
                "total_steps": 6,
                "sub_steps": {
                    "storyboard_design": {"total": N, "completed": M},
                    "video_rendering": {"total": N, "completed": M},
                },
                "artifacts": {"path": {"exists": bool, "size": int, "lastModified": str}},
            }
        """
        idx = self._session_index
        session = idx.get(session_id) if idx else None
        stage = (session or {}).get("stage", "created")

        wd = idx.working_dir(session_id) if idx else None
        i2v = wd / "idea2video" if wd else None

        # Determine completed steps from artifact presence
        completed_steps: list[str] = []
        artifacts: dict[str, dict[str, Any]] = {}

        if i2v:
            # Check each artifact
            story_path = i2v / "story.txt"
            if story_path.exists():
                completed_steps.append("story_generation")
                artifacts["idea2video/story.txt"] = {
                    "exists": True,
                    "size": story_path.stat().st_size,
                    "lastModified": datetime.fromtimestamp(story_path.stat().st_mtime).isoformat(),
                }

            chars_path = i2v / "characters.json"
            if chars_path.exists():
                completed_steps.append("character_extraction")
                artifacts["idea2video/characters.json"] = {
                    "exists": True,
                    "size": chars_path.stat().st_size,
                    "lastModified": datetime.fromtimestamp(chars_path.stat().st_mtime).isoformat(),
                }

            script_path = i2v / "script.json"
            if script_path.exists():
                completed_steps.append("script_writing")
                artifacts["idea2video/script.json"] = {
                    "exists": True,
                    "size": script_path.stat().st_size,
                    "lastModified": datetime.fromtimestamp(script_path.stat().st_mtime).isoformat(),
                }

            # Storyboard sub-scenes
            sb_total = 0
            sb_completed = 0
            for scene_dir in sorted(i2v.glob("scene_*")):
                sb_total += 1
                sb_json = scene_dir / "storyboard.json"
                artifacts[f"idea2video/{scene_dir.name}/storyboard.json"] = {
                    "exists": sb_json.exists(),
                    "size": sb_json.stat().st_size if sb_json.exists() else 0,
                    "lastModified": datetime.fromtimestamp(sb_json.stat().st_mtime).isoformat() if sb_json.exists() else None,
                }
                if sb_json.exists():
                    sb_completed += 1
            if sb_total > 0:
                if "storyboard_design" not in completed_steps and sb_completed > 0:
                    completed_steps.append("storyboard_design")

            # Character portraits
            portraits_dir = i2v / "character_portraits"
            if portraits_dir.exists():
                completed_steps.append("character_portraits")
                for img_file in portraits_dir.glob("**/*.png"):
                    rel = str(img_file.relative_to(wd))
                    artifacts[rel] = {
                        "exists": True,
                        "size": img_file.stat().st_size,
                        "lastModified": datetime.fromtimestamp(img_file.stat().st_mtime).isoformat(),
                    }

            # Video scenes
            vid_total = 0
            vid_completed = 0
            for scene_dir in sorted(i2v.glob("scene_*")):
                vid_total += 1
                output_mp4 = scene_dir / "output.mp4"
                if output_mp4.exists():
                    vid_completed += 1
            if vid_total > 0 and vid_completed > 0:
                if "video_rendering" not in completed_steps:
                    completed_steps.append("video_rendering")

        # Current step inference
        current_step: str | None = None
        if completed_steps:
            step_order = [
                "story_generation", "character_extraction", "script_writing",
                "storyboard_design", "character_portraits", "video_rendering",
            ]
            last_idx = max(step_order.index(s) for s in completed_steps if s in step_order)
            if last_idx < 5:
                current_step = step_order[last_idx + 1]

        return {
            "session_id": session_id,
            "stage": stage,
            "completed_steps": completed_steps,
            "current_step": current_step,
            "total_steps": 6,
            "sub_steps": {
                "storyboard_design": {
                    "total": sb_total if i2v else 0,
                    "completed": sb_completed if i2v else 0,
                },
                "video_rendering": {
                    "total": vid_total if i2v else 0,
                    "completed": vid_completed if i2v else 0,
                },
            },
            "artifacts": artifacts,
        }

    # ── V3 Public API: step plan ──────────────────────────────────────

    def get_step_plan(self, session_id: str, step_name: str) -> dict[str, Any]:
        """Return the planned sub-steps / configuration for a given step.

        Args:
            session_id: The session to query.
            step_name: Machine step name.

        Returns:
            {
                "step_name": str,
                "sub_steps": [...],        # list of sub-step descriptors
                "artifacts": [...],        # expected output artifact paths
                "dependencies": [...],     # prerequisite step names
                "estimated_duration": str,
            }
        """
        STEP_PLANS: dict[str, dict] = {
            "story_generation": {
                "step_name": "story_generation",
                "sub_steps": ["parse_intent", "develop_story", "save_artifact"],
                "artifacts": ["idea2video/story.txt"],
                "dependencies": [],
                "estimated_duration": "约 30 秒",
            },
            "character_extraction": {
                "step_name": "character_extraction",
                "sub_steps": ["read_story", "extract_characters", "save_artifact"],
                "artifacts": ["idea2video/characters.json"],
                "dependencies": ["story_generation"],
                "estimated_duration": "约 20 秒",
            },
            "script_writing": {
                "step_name": "script_writing",
                "sub_steps": ["read_context", "write_script", "save_artifact"],
                "artifacts": ["idea2video/script.json"],
                "dependencies": ["story_generation", "character_extraction"],
                "estimated_duration": "约 30 秒",
            },
            "storyboard_design": {
                "step_name": "storyboard_design",
                "sub_steps": ["read_script", "plan_scene_0", "plan_scene_1", "plan_scene_2", "save_artifacts"],
                "artifacts": ["idea2video/scene_0/storyboard.json", "idea2video/scene_1/storyboard.json", "idea2video/scene_2/storyboard.json"],
                "dependencies": ["script_writing"],
                "estimated_duration": "约 60 秒 (多场景)",
            },
            "character_portraits": {
                "step_name": "character_portraits",
                "sub_steps": ["read_characters", "generate_front", "generate_side", "generate_back", "save_artifacts"],
                "artifacts": ["idea2video/character_portraits/"],
                "dependencies": ["character_extraction", "storyboard_design"],
                "estimated_duration": "约 2 分钟 (多角色)",
            },
            "video_rendering": {
                "step_name": "video_rendering",
                "sub_steps": ["render_scene_0", "render_scene_1", "render_scene_2", "compose_final"],
                "artifacts": ["idea2video/scene_0/output.mp4", "idea2video/scene_1/output.mp4", "idea2video/scene_2/output.mp4", "idea2video/final_video.mp4"],
                "dependencies": ["storyboard_design", "character_portraits"],
                "estimated_duration": "约 5 分钟 (多场景)",
            },
        }
        if step_name in STEP_PLANS:
            return STEP_PLANS[step_name]
        return {
            "step_name": step_name,
            "sub_steps": [],
            "artifacts": [],
            "dependencies": [],
            "estimated_duration": "未知",
            "error": f"Unknown step: {step_name}",
        }

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
        # Also cancel the asyncio.Task to propagate CancelledError immediately
        task = self._tasks.get(session_id)
        if task and not task.done():
            task.cancel()
        return {"cancelled": True, "session_id": session_id}

    # ── Circuit breaker helpers ───────────────────────────────────────

    async def _generate_mock_rendering(self, session_id: str) -> None:
        """Generate mock portrait and video data when rendering is unavailable."""
        import shutil
        wd = self._session_index.working_dir(session_id)
        i2v_dir = wd / "idea2video"

        # Load characters for portrait metadata
        chars_path = i2v_dir / "characters.json"
        chars_data = []
        if chars_path.exists():
            try:
                chars_data = json.loads(chars_path.read_text(encoding="utf-8"))
            except Exception:
                pass

        # 1) Mock character portraits — create placeholder images
        portraits_dir = i2v_dir / "character_portraits"
        portraits_dir.mkdir(parents=True, exist_ok=True)
        portrait_entries = []
        for c in chars_data[:4]:  # max 4 characters
            name = c.get("name", c.get("identifier_in_scene", "unknown"))
            char_dir = portraits_dir / f"{c.get('idx', 0)}_{name}"
            char_dir.mkdir(parents=True, exist_ok=True)
            for view in ["front", "side", "back"]:
                img_path = char_dir / f"{view}.png"
                if not img_path.exists():
                    # Create a tiny valid PNG placeholder (1x1 pixel)
                    img_path.write_bytes(
                        b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01'
                        b'\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde'
                        b'\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05'
                        b'\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82'
                    )
            portrait_entries.append({
                "character_name": name,
                "character_id": c.get("identifier_in_scene", name),
                "views": {"front": f"character_portraits/{c.get('idx', 0)}_{name}/front.png",
                          "side": f"character_portraits/{c.get('idx', 0)}_{name}/side.png",
                          "back": f"character_portraits/{c.get('idx', 0)}_{name}/back.png"},
            })

        # 2) Mock video — create minimal MP4 placeholder
        video_path = i2v_dir / "final_video.mp4"
        if not video_path.exists():
            # Write a placeholder text file (real MP4 generation needs ffmpeg)
            video_path.write_text("mock_video_placeholder", encoding="utf-8")

        self._session_index.update_stage(session_id, "rendered", "Rendering complete (mock)")

        logger.info("Mock rendering data generated for session %s (%d portraits)", session_id, len(portrait_entries))

    def _record_render_failure(self, session_id: str) -> None:
        """Record a render failure timestamp for circuit breaker tracking."""
        self._render_failures.setdefault(session_id, []).append(time.time())

    # ── Cleanup ───────────────────────────────────────────────────────

    def _cleanup(self, session_id: str) -> None:
        self._tasks.pop(session_id, None)
        self._cancel_events.pop(session_id, None)
        self._ws_connections.pop(session_id, None)
        # Purge expired circuit-breaker entries on every cleanup so
        # abandoned sessions don't leak memory in long-running services.
        ts = self._render_failures.get(session_id)
        if ts:
            now = time.time()
            fresh = [t for t in ts if now - t < _CB_WINDOW_SECONDS]
            if fresh:
                self._render_failures[session_id] = fresh
            else:
                del self._render_failures[session_id]
