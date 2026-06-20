#!/usr/bin/env bash
# ViMax - 使用阿里云 DashScope (OpenAI 兼容) 运行
#
# 用法:
#   source run_with_dashscope.sh  # 设置环境变量
#   uv run python main_idea2video.py  # 运行 idea2video workflow
#
# 或直接:
#   bash run_with_dashscope.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 使用 DashScope (阿里云 Model Studio) 作为 LLM
export OPENAI_API_KEY="${DASHSCOPE_API_KEY:-}"
export VIMAX_LLM_MODEL="qwen-plus"
export VIMAX_LLM_MODEL_PROVIDER="openai"
export VIMAX_LLM_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
export VIMAX_LLM_API_KEY="${DASHSCOPE_API_KEY:-}"

if [ -z "$OPENAI_API_KEY" ]; then
    echo "❌ 请先设置 DASHSCOPE_API_KEY 环境变量"
    echo "   export DASHSCOPE_API_KEY=your_key_here"
    exit 1
fi

echo "🚀 ViMax + DashScope 已就绪"
echo "  LLM: qwen-plus @ dashscope.aliyuncs.com"
echo ""
echo "运行 workflow:"
echo "  uv run python test_workflow.py          # LLM 工作流测试"
echo ""
echo "需要图片/视频生成时，额外设置:"
echo "  export GOOGLE_API_KEY=your_google_key   # Google AI"
echo "  # 或"
echo "  export VIMAX_IMAGE_API_KEY=your_key     # Yunwu 代理"
echo "  export VIMAX_VIDEO_API_KEY=your_key     # OpenRouter/Yunwu"

# 如果用户传了参数，执行它
if [ $# -gt 0 ]; then
    exec "$@"
fi
