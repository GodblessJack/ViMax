#!/usr/bin/env bash
# ── ViMax Web Circuit Breaker (PreToolUse Hook) ──────────────────────────
# 6 项安全检查，每次工具调用前执行
# 设计原则：fail-open（任何错误返回 exit 0，不阻塞主流程）
# 来源：LoopEngineer circuit-breaker.sh 模板
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG="$PROJECT_ROOT/loop.config.yaml"
STATE_DIR="$HOME/.claude/state"
mkdir -p "$STATE_DIR"

# ── 读取 stdin JSON ──
INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""')

# ── YAML 解析（优先 python3，fallback yq，最后默认值） ──
parse_yaml() {
    local key="$1"
    local default="$2"
    if command -v python3 &>/dev/null && [ -f "$CONFIG" ]; then
        python3 -c "
import yaml, sys
try:
    with open('$CONFIG') as f:
        cfg = yaml.safe_load(f)
    keys = '$key'.split('.')
    v = cfg
    for k in keys:
        v = v.get(k, {})
    print(v if v is not None else '$default')
except: print('$default')
" 2>/dev/null || echo "$default"
    else
        echo "$default"
    fi
}

# ═══════════════════════════════════════════════════════════════════════
# 1. max_turns: 步数限制
# ═══════════════════════════════════════════════════════════════════════
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
SAFE_SID=$(echo "$SESSION_ID" | tr -dc 'a-zA-Z0-9_-' | head -c 32)
TURN_FILE="$STATE_DIR/cb-turn-$SAFE_SID"
MAX_TURNS=$(parse_yaml "brakes.max_turns" "80")

if [[ -n "$SAFE_SID" && "$SAFE_SID" != "unknown" ]]; then
    if [[ -f "$TURN_FILE" ]]; then
        TURNS=$(cat "$TURN_FILE")
    else
        TURNS=0
    fi
    TURNS=$((TURNS + 1))
    echo "$TURNS" > "$TURN_FILE"

    if [[ $TURNS -gt $MAX_TURNS ]]; then
        echo "[circuit-breaker] ⛔ max_turns ($MAX_TURNS) 超限 (当前: $TURNS)" >&2
        echo "⚠️ 会话步数已达上限 ($MAX_TURNS)。请检查 /goal 是否需要调整或缩小任务范围。" >&2
        # 不 exit 非 0 — circuit-breaker 只警告不阻塞（fail-open design）
        # 真正的刹车在 Claude Code 的 maxTurns 设置中
    else
        echo "[circuit-breaker] turns: $TURNS/$MAX_TURNS" >&2
    fi
fi

# ═══════════════════════════════════════════════════════════════════════
# 2. scope: 写入路径白名单检查
# ═══════════════════════════════════════════════════════════════════════
if [[ "$TOOL" == "Write" || "$TOOL" == "Edit" || "$TOOL" == "NotebookEdit" ]]; then
    FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input | .file_path // ""')
    if [[ -n "$FILE_PATH" && "$FILE_PATH" != "null" ]]; then
        # 获取 scope 列表
        SCOPE_RAW=$(parse_yaml "brakes.scope" "web/")
        # 简化检查：文件路径是否在项目目录内
        if [[ "$FILE_PATH" != "$PROJECT_ROOT"* && "$FILE_PATH" != /home/admin/ViMax/web/* ]]; then
            echo "[circuit-breaker] ⚠️ scope: 写入路径超出范围 — $FILE_PATH" >&2
            echo "   允许范围: $PROJECT_ROOT/" >&2
        fi
    fi
fi

# ═══════════════════════════════════════════════════════════════════════
# 3. write_branches: 分支检查（从 loop.config.yaml 读取允许列表）
# ═══════════════════════════════════════════════════════════════════════
if [[ "$TOOL" == "Write" || "$TOOL" == "Edit" ]]; then
    BRANCH=$(cd "$PROJECT_ROOT" && git branch --show-current 2>/dev/null || echo "unknown")
    BRANCH_ALLOWED="true"
    if command -v python3 &>/dev/null && [ -f "$CONFIG" ]; then
        BRANCH_ALLOWED=$(python3 -c "
import yaml, fnmatch
try:
    with open('$CONFIG') as f:
        cfg = yaml.safe_load(f)
    patterns = cfg.get('brakes',{}).get('write_branches',['*'])
    branch = '$BRANCH'
    ok = any(fnmatch.fnmatch(branch, p) for p in patterns)
    print('true' if ok else 'false')
except: print('true')
" 2>/dev/null) || BRANCH_ALLOWED="true"
    fi
    if [[ "$BRANCH_ALLOWED" != "true" ]]; then
        echo "[circuit-breaker] ⚠️ 当前分支 $BRANCH 不在 write_branches 允许列表中" >&2
    fi
fi

# ═══════════════════════════════════════════════════════════════════════
# 4. circuit_breaker: 同 tool+input 重复检测
# ═══════════════════════════════════════════════════════════════════════
MAX_REPEAT=$(parse_yaml "brakes.circuit_breaker" "3")
TOOL_INPUT_HASH=$(echo "$INPUT" | jq -c '{t: .tool_name, i: .tool_input}' | md5sum | cut -d' ' -f1)
REPEAT_FILE="$STATE_DIR/cb-repeat-$SAFE_SID"

if [[ -f "$REPEAT_FILE" ]]; then
    LAST_HASH=$(head -1 "$REPEAT_FILE")
    REPEAT_COUNT=$(sed -n '2p' "$REPEAT_FILE" 2>/dev/null || echo 0)

    if [[ "$TOOL_INPUT_HASH" == "$LAST_HASH" ]]; then
        REPEAT_COUNT=$((REPEAT_COUNT + 1))
        if [[ $REPEAT_COUNT -ge $MAX_REPEAT ]]; then
            echo "[circuit-breaker] ⛔ circuit_breaker: 同一操作连续重复 $REPEAT_COUNT 次（≥$MAX_REPEAT）" >&2
            echo "   操作: $TOOL" >&2
            echo "   ⚠️ 检测到可能的死循环，建议检查 /goal 或手动介入" >&2
        fi
    else
        REPEAT_COUNT=1
    fi
else
    REPEAT_COUNT=1
fi
echo -e "$TOOL_INPUT_HASH\n$REPEAT_COUNT" > "$REPEAT_FILE"

# ═══════════════════════════════════════════════════════════════════════
# 5. heartbeat: STATUS.md 活跃性检查
# ═══════════════════════════════════════════════════════════════════════
HEARTBEAT_MAX=$(parse_yaml "brakes.heartbeat_max_age_min" "120")
STATUS_FILE="$PROJECT_ROOT/STATUS.md"

if [[ -f "$STATUS_FILE" ]]; then
    STATUS_AGE=$(( $(date +%s) - $(stat -c %Y "$STATUS_FILE" 2>/dev/null || date +%s) ))
    STATUS_AGE_MIN=$(( STATUS_AGE / 60 ))
    if [[ $STATUS_AGE_MIN -gt $HEARTBEAT_MAX ]]; then
        echo "[circuit-breaker] ⚠️ heartbeat: STATUS.md $STATUS_AGE_MIN 分钟未更新 (上限: $HEARTBEAT_MAX)" >&2
        echo "   可能静默死亡，建议检查当前进度" >&2
    fi
fi

echo "[circuit-breaker] ✅ checks passed" >&2
exit 0
