"""Simple AI chat router for the AI assistant panel — reads LLM config from ViMax."""

import logging
import os
from fastapi import APIRouter
from pydantic import BaseModel

from agent_runtime.config import llm_api_key, llm_base_url, llm_model, llm_model_provider

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    message: str
    session_id: str = ""
    step: int = 1
    context: str = ""


class ChatResponse(BaseModel):
    reply: str


SYSTEM_PROMPTS = {
    1: "你是 ViMax 创作助手。用户正在输入创意和选择风格。帮助用户完善创意描述，推荐合适的风格。用中文回复，简洁友好，不超过3句话。",
    2: "你是 ViMax 创作助手。AI已生成故事大纲、角色和分集。帮助用户审阅内容。用户可以要求修改角色名、调整故事细节。用中文回复。",
    3: "你是 ViMax 创作助手。用户正在查看分镜列表。帮助用户理解镜头语言，可以建议修改某个镜头的角度或描述。用中文回复。",
    4: "你是 ViMax 创作助手。视频正在生成中（角色肖像 → 场景渲染）。告知用户当前进度，如果用户对某个画面不满意可以说'可以返回修改后重新生成'。不要虚构功能。用中文回复。",
    5: "你是 ViMax 创作助手。视频已生成完成。你可以告诉用户点击预览播放视频、使用下载按钮保存 MP4 文件。不要虚构或承诺任何本平台不提供的功能（如分辨率选择、字幕导出、GIF、分享链接、水印等）。用中文回复，简洁务实。",
}


def _build_chat_model():
    """Build a chat model from ViMax config, with DashScope fallback."""
    from langchain.chat_models import init_chat_model
    from web.backend.config import backend_config
    root = str(backend_config.vi_max_root)
    api_key = llm_api_key(root)
    model = llm_model(root)
    provider = llm_model_provider(root)
    base = llm_base_url(root)

    # DashScope fallback when the primary llm config has no key
    ds_key = os.environ.get("DASHSCOPE_API_KEY", "")
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
        timeout=60,
        max_retries=1,
        max_completion_tokens=1024,
    )


@router.post("", response_model=ChatResponse)
async def chat(body: ChatRequest):
    """Send a chat message to the AI assistant.

    .. deprecated::
        This endpoint is DEPRECATED and will be removed in a future release.
        Use the WebSocket ``user:message`` event instead for real-time chat.
        See architecture-v2-design.md Section 6.4.
    """
    # Guard: reject empty messages early
    if not body.message.strip():
        return ChatResponse(reply="请描述你想创建的短剧内容，或提出具体问题，我会尽力帮你。")

    try:
        chat_model = _build_chat_model()
    except Exception as e:
        logger.exception("Failed to build chat model")
        return ChatResponse(reply="AI 助手配置错误，请检查 ViMax LLM 配置。")

    system_prompt = SYSTEM_PROMPTS.get(body.step, SYSTEM_PROMPTS[1])

    context = ""
    if body.session_id:
        try:
            from web.backend.main import get_session_service
            svc = get_session_service()
            session = svc._index.get(body.session_id)
            if session:
                ctx_parts = []
                idea = session.get("idea", "")
                if idea:
                    ctx_parts.append(f"创意: {idea}")
                stage = session.get("stage", "")
                if stage:
                    ctx_parts.append(f"当前阶段: {stage}")
                wd = svc._index.working_dir(body.session_id)
                story_path = wd / "idea2video" / "story.txt"
                if story_path.exists():
                    ctx_parts.append(f"故事: {story_path.read_text()[:500]}")
                chars_path = wd / "idea2video" / "characters.json"
                if chars_path.exists():
                    ctx_parts.append(f"角色信息: {chars_path.read_text()[:300]}")
                context = "\n\n".join(ctx_parts)
        except Exception:
            logger.debug("Failed to load session context for chat", exc_info=True)

    try:
        messages = [
            {"role": "system", "content": system_prompt},
        ]
        if body.context:
            messages.append({"role": "system", "content": f"当前界面信息:\n{body.context}"})
        if context:
            messages.append({"role": "system", "content": f"项目数据:\n{context}"})
        messages.append({"role": "user", "content": body.message})

        response = await chat_model.ainvoke(messages)
        return ChatResponse(reply=str(response.content))
    except Exception:
        logger.exception("Chat invocation failed for session %s", body.session_id)
        return ChatResponse(reply="抱歉，AI 服务暂时不可用，请稍后重试。")
