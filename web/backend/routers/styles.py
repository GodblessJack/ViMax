"""Style presets router."""

from fastapi import APIRouter

from web.backend.models.api_models import StylePreset

router = APIRouter(prefix="/api/styles", tags=["styles"])

_PRESETS = [
    StylePreset(key="wuxia", name="武侠风", emoji="🎭", description="武侠江湖，刀光剑影，快意恩仇"),
    StylePreset(key="ancient", name="古风", emoji="🏛️", description="古色古香，汉服唐装，典雅韵味"),
    StylePreset(key="modern", name="现代风", emoji="🌆", description="都市生活，时尚简约，真实质感"),
    StylePreset(key="suspense", name="悬疑风", emoji="🔮", description="紧张氛围，暗调光影，引人入胜"),
    StylePreset(key="comedy", name="喜剧风", emoji="😂", description="轻松幽默，明快色调，欢乐氛围"),
    StylePreset(key="realistic", name="写实风", emoji="📷", description="真实感十足，自然光影，纪录片质感"),
    StylePreset(key="anime", name="动漫风", emoji="🎨", description="二次元动漫，卡通渲染，生动活泼"),
]


@router.get("", response_model=list[StylePreset])
async def list_styles():
    return _PRESETS
