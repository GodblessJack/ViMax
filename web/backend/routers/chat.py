"""Simple AI chat router for the AI assistant panel."""

import os
from fastapi import APIRouter
from pydantic import BaseModel
from langchain.chat_models import init_chat_model

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
    4: "你是 ViMax 创作助手。视频正在生成中。告知用户生成进度，如果用户对某个画面不满意可以说'我会重新生成'。用中文回复。",
    5: "你是 ViMax 创作助手。视频已生成完成。引导用户预览和下载。用中文回复。",
}


@router.post("", response_model=ChatResponse)
async def chat(body: ChatRequest):
    ds_key = os.environ.get("DASHSCOPE_API_KEY", "")
    if not ds_key:
        return ChatResponse(reply="AI 助手需要配置 API key。请在 .env 中设置 DASHSCOPE_API_KEY。")

    system_prompt = SYSTEM_PROMPTS.get(body.step, SYSTEM_PROMPTS[1])

    context = ""
    if body.session_id:
        try:
            from agent_runtime.session_index import SessionIndex
            si = SessionIndex(".")
            session = si.get(body.session_id)
            if session:
                ctx_parts = []
                idea = session.get("idea", "")
                if idea:
                    ctx_parts.append(f"创意: {idea}")
                stage = session.get("stage", "")
                if stage:
                    ctx_parts.append(f"当前阶段: {stage}")
                # Load artifacts if available
                wd = si.working_dir(body.session_id)
                story_path = wd / "idea2video" / "story.txt"
                if story_path.exists():
                    ctx_parts.append(f"故事: {story_path.read_text()[:500]}")
                chars_path = wd / "idea2video" / "characters.json"
                if chars_path.exists():
                    ctx_parts.append(f"角色信息: {chars_path.read_text()[:300]}")
                context = "\n\n".join(ctx_parts)
        except Exception:
            pass

    try:
        chat_model = init_chat_model(
            model="qwen-plus",
            model_provider="openai",
            api_key=ds_key,
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            timeout=60,
            max_retries=1,
            max_completion_tokens=512,
        )
        messages = [
            {"role": "system", "content": system_prompt},
        ]
        if context:
            messages.append({"role": "system", "content": f"当前项目信息:\n{context}"})
        messages.append({"role": "user", "content": body.message})

        response = await chat_model.ainvoke(messages)
        return ChatResponse(reply=str(response.content))
    except Exception as e:
        return ChatResponse(reply=f"抱歉，AI 服务暂时不可用：{str(e)[:100]}")
