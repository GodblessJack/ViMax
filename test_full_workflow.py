#!/usr/bin/env python3
"""
ViMax 完整端到端工作流测试——使用 DashScope 运行从创意到视频的全流程。

用法:
    uv run python test_full_workflow.py
"""
import os
import sys
import asyncio
import logging

logging.basicConfig(level=logging.WARNING)

# 确保 API keys 已设置
if "OPENAI_API_KEY" not in os.environ:
    dashscope_key = os.environ.get("DASHSCOPE_API_KEY", "")
    if dashscope_key:
        os.environ["OPENAI_API_KEY"] = dashscope_key
    else:
        print("❌ 请设置 DASHSCOPE_API_KEY 环境变量")
        sys.exit(1)

from pipelines.idea2video_pipeline import Idea2VideoPipeline


async def main():
    print("=" * 60)
    print("🚀 ViMax 完整端到端工作流测试")
    print("=" * 60)
    print("API: DashScope (通义千问 + 通义万相)")
    print()

    # 初始化流水线
    print("📦 初始化 Idea2Video Pipeline...")
    pipeline = Idea2VideoPipeline.init_from_config("configs/idea2video.yaml")
    print(f"   Chat: {type(pipeline.chat_model).__name__}")
    print(f"   Image: {type(pipeline.image_generator).__name__}")
    print(f"   Video: {type(pipeline.video_generator).__name__}")
    print(f"   Working dir: {pipeline.working_dir}")
    print()

    # 最简单的创意（最小化 API 调用）
    idea = "A small orange kitten meets a friendly puppy in a garden"
    user_requirement = """
For children. Must have exactly 1 scene with at most 2 shots.
Keep it very short and simple.
"""
    style = "Cartoon, warm colors, simple shapes"

    print(f"💡 创意: {idea}")
    print(f"📋 需求: {user_requirement.strip()}")
    print(f"🎨 风格: {style}")
    print()
    print("⏳ 开始运行完整工作流...")
    print()

    try:
        final_video = await pipeline(
            idea=idea,
            user_requirement=user_requirement,
            style=style,
            quiet=False,
        )
        print()
        print("=" * 60)
        print(f"✅ 完整工作流成功!")
        print(f"📹 最终视频: {final_video}")
        if os.path.exists(final_video):
            size_mb = os.path.getsize(final_video) / (1024 * 1024)
            print(f"📏 文件大小: {size_mb:.1f} MB")
        print("=" * 60)
    except Exception as e:
        print(f"\n❌ 工作流失败: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
