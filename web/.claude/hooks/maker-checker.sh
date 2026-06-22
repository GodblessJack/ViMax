#!/usr/bin/env bash
# ── ViMax Web Maker-Checker (PostToolUse Hook) ──────────────────────────
# 3 层验证：Python 后端测试 → TypeScript 类型检查 → 配置安全扫描
# 设计原则：async + asyncRewake（成功静默，失败唤醒 Claude）
#          fail-open（依赖缺失时 exit 0，不阻塞主流程）
# 来源：LoopEngineer maker-checker.sh 模板，适配 ViMax Python+TS 技术栈
set -euo pipefail

# ── 读取 stdin JSON ──
INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""')
TOOL_INPUT=$(echo "$INPUT" | jq -r '.tool_input // "{}"')

# ── 只对文件写入/编辑操作触发 ──
if [[ "$TOOL" != "Write" && "$TOOL" != "Edit" && "$TOOL" != "NotebookEdit" ]]; then
    exit 0
fi

# ── 提取目标文件路径 ──
FILE_PATH=$(echo "$TOOL_INPUT" | jq -r '.file_path // ""')
if [[ -z "$FILE_PATH" || "$FILE_PATH" == "null" ]]; then
    exit 0
fi

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FAILED=0
FAILURES=""

# ═══════════════════════════════════════════════════════════════════════
# Layer 1: Python 后端测试（修改 backend/ 文件时触发）
# ═══════════════════════════════════════════════════════════════════════
if [[ "$FILE_PATH" == *"/backend/"* ]] && [[ "$FILE_PATH" == *".py" ]]; then
    if command -v python3 &>/dev/null && [ -d "$PROJECT_ROOT/backend/tests" ]; then
        echo "[maker-checker] L1: Python 后端测试..." >&2
        cd "$PROJECT_ROOT/backend"
        if python3 -m pytest tests/ -x --no-header -q --timeout=60 2>&1; then
            echo "[maker-checker] L1: PASSED" >&2
        else
            echo "[maker-checker] L1: FAILED — 后端测试未通过" >&2
            FAILED=1
            FAILURES="$FAILURES\n  - Python 后端测试失败"
        fi
        cd "$PROJECT_ROOT"
    else
        echo "[maker-checker] L1: SKIP (python3 或 tests/ 不可用)" >&2
    fi
fi

# ═══════════════════════════════════════════════════════════════════════
# Layer 2: TypeScript 类型检查（修改 frontend/src/ 文件时触发）
# ═══════════════════════════════════════════════════════════════════════
if [[ "$FILE_PATH" == *"/frontend/src/"* ]] && [[ "$FILE_PATH" =~ \.(ts|tsx)$ ]]; then
    if command -v npx &>/dev/null && [ -f "$PROJECT_ROOT/frontend/tsconfig.app.json" ]; then
        echo "[maker-checker] L2: TypeScript 类型检查..." >&2
        cd "$PROJECT_ROOT/frontend"
        if npx tsc --noEmit 2>&1; then
            echo "[maker-checker] L2: PASSED" >&2
        else
            echo "[maker-checker] L2: FAILED — TypeScript 编译错误" >&2
            FAILED=1
            FAILURES="$FAILURES\n  - TypeScript 类型检查失败"
        fi
        cd "$PROJECT_ROOT"
    else
        echo "[maker-checker] L2: SKIP (npx 或 tsconfig 不可用)" >&2
    fi
fi

# ═══════════════════════════════════════════════════════════════════════
# Layer 3: 配置安全扫描（修改 config, .env 等敏感文件时触发）
# ═══════════════════════════════════════════════════════════════════════
if [[ "$FILE_PATH" =~ \.(env|config\.py|config\.yaml|config\.yml)$ ]] || \
   [[ "$FILE_PATH" == *"/.env"* ]] || [[ "$FILE_PATH" == *"/credentials"* ]]; then
    echo "[maker-checker] L3: 安全扫描..." >&2
    # 检查是否包含硬编码的 API key / token / secret
    SENSITIVE_PATTERNS=(
        'sk-[a-zA-Z0-9]{32,}'
        'api[_-]?key\s*=\s*"[^"]{20,}"'
        'token\s*=\s*"[^"]{20,}"'
        'secret\s*=\s*"[^"]{20,}"'
        'password\s*=\s*"[^"]+"'
        'AKIA[0-9A-Z]{16}'
        'AIza[0-9A-Za-z\-_]{35}'
    )
    SCAN_FAILED=0
    for pattern in "${SENSITIVE_PATTERNS[@]}"; do
        if grep -Eq "$pattern" "$FILE_PATH" 2>/dev/null; then
            echo "[maker-checker] L3: WARNING — 检测到可能的敏感信息: $pattern" >&2
            SCAN_FAILED=1
        fi
    done
    if [[ $SCAN_FAILED -eq 0 ]]; then
        echo "[maker-checker] L3: PASSED" >&2
    else
        echo "[maker-checker] L3: FAILED — 文件可能包含敏感信息，请检查后移除" >&2
        FAILED=1
        FAILURES="$FAILURES\n  - 安全扫描: 检测到可能的硬编码密钥"
    fi
fi

# ═══════════════════════════════════════════════════════════════════════
# 结果判定
# ═══════════════════════════════════════════════════════════════════════
if [[ $FAILED -eq 1 ]]; then
    echo "[maker-checker] ⛔ 验证失败:$FAILURES" >&2
    # exit 2 配合 asyncRewake: true 会唤醒 Claude 报告失败
    exit 2
fi

echo "[maker-checker] ✅ 全部验证通过" >&2
exit 0
