#!/usr/bin/env python3
"""
ViMax LLM Workflow Test - 使用 DashScope 运行 LLM 叙事规划流程。

用法:
    OPENAI_API_KEY="$DASHSCOPE_API_KEY" uv run python test_workflow.py
"""
import os
import sys
import asyncio
import logging

logging.basicConfig(level=logging.WARNING)

# 设置 API key
if "OPENAI_API_KEY" not in os.environ:
    dashscope_key = os.environ.get("DASHSCOPE_API_KEY", "")
    if dashscope_key:
        os.environ["OPENAI_API_KEY"] = dashscope_key
    else:
        print("❌ 请设置 DASHSCOPE_API_KEY 或 OPENAI_API_KEY 环境变量")
        sys.exit(1)

from langchain.chat_models import init_chat_model
from agents import Screenwriter, CharacterExtractor, StoryboardArtist


async def test_screenwriter():
    """测试: 从创意生成故事"""
    print("\n" + "=" * 60)
    print("📝 测试 1: Screenwriter - 从创意生成故事")
    print("=" * 60)

    chat_model = init_chat_model(
        model="qwen-plus",
        model_provider="openai",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
    )
    screenwriter = Screenwriter(chat_model=chat_model)

    idea = "一只猫和一只狗在暴风雨中互相救助，最终成为最好的朋友"
    user_requirement = "面向儿童，最多3个场景，温馨感人，积极向上"

    print(f"创意: {idea}")
    print(f"需求: {user_requirement}")
    print("⏳ 生成中...")

    story = await screenwriter.develop_story(idea=idea, user_requirement=user_requirement)

    print(f"✅ 故事生成成功! ({len(story)} 字符)")
    print(f"\n故事预览:\n{story[:300]}...\n")
    return story, chat_model


async def test_character_extraction(chat_model, story: str):
    """测试: 从故事中提取角色"""
    print("=" * 60)
    print("👤 测试 2: CharacterExtractor - 提取角色")
    print("=" * 60)

    extractor = CharacterExtractor(chat_model=chat_model)

    print("⏳ 提取中...")
    characters = await extractor.extract_characters(story)

    print(f"✅ 提取到 {len(characters)} 个角色:")
    for char in characters:
        desc = char.static_features or "N/A"
        visible = "👁️" if char.is_visible else "🚫"
        print(f"  {visible} {char.identifier_in_scene}: {desc[:80]}...")
    print()
    return characters


async def test_storyboard(chat_model, story: str, characters, user_requirement: str):
    """测试: 设计分镜"""
    print("=" * 60)
    print("🎬 测试 3: StoryboardArtist - 设计分镜")
    print("=" * 60)

    artist = StoryboardArtist(chat_model=chat_model)

    print("⏳ 设计中...")
    storyboard = await artist.design_storyboard(
        script=story,
        characters=characters,
        user_requirement=user_requirement,
    )

    print(f"✅ 分镜设计完成! 共 {len(storyboard)} 个镜头:")
    for i, shot in enumerate(storyboard[:5]):
        cam = f"Cam{shot.cam_idx}"
        desc = shot.visual_desc[:80] if shot.visual_desc else "N/A"
        print(f"  镜头 {i+1} [{cam}]: {desc}...")
    if len(storyboard) > 5:
        print(f"  ... 还有 {len(storyboard) - 5} 个镜头")
    print()
    return storyboard


async def main():
    print("🚀 ViMax LLM Workflow 测试")
    print(f"API: DashScope (qwen-plus)")
    print(f"Base URL: https://dashscope.aliyuncs.com/compatible-mode/v1")

    try:
        # 1. 生成故事
        story, chat_model = await test_screenwriter()

        # 2. 提取角色
        characters = await test_character_extraction(chat_model, story)

        # 3. 设计分镜
        storyboard = await test_storyboard(chat_model, story, characters,
                                           "面向儿童，温馨感人")

        print("=" * 60)
        print("✅ 所有 LLM Workflow 测试通过!")
        print("=" * 60)
        print("\n📋 总结:")
        print(f"  - 故事生成: ✅ ({len(story)} 字符)")
        print(f"  - 角色提取: ✅ ({len(characters)} 个角色)")
        print(f"  - 分镜设计: ✅ ({len(storyboard)} 个镜头)")
        print("\n💡 提示: 图像和视频生成需要额外的 API key:")
        print("  - 图片生成: Google AI API key (或 Yunwu API key)")
        print("  - 视频生成: Google Veo / OpenRouter / Yunwu API key")

    except Exception as e:
        print(f"\n❌ 错误: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
