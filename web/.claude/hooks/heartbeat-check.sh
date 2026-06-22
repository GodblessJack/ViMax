#!/usr/bin/env bash
# ── ViMax Web SessionStart Heartbeat (SessionStart Hook) ──────────────
# 启动时检查项目健康状态：STATUS.md 活跃性、inbox 积压、thrashing 信号
# 设计原则：fail-open，只报告不阻塞
# 来源：LoopEngineer heartbeat-check.sh 模板
set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATUS_FILE="$PROJECT_ROOT/STATUS.md"
LEARNINGS_FILE="$PROJECT_ROOT/LEARNINGS.md"
INBOX_DIR="$PROJECT_ROOT/.claude/learnings/inbox"
CONFIG="$PROJECT_ROOT/loop.config.yaml"

WARNINGS=""

# ── 解析配置 ──
HEARTBEAT_MAX=240
if command -v python3 &>/dev/null && [ -f "$CONFIG" ]; then
    VAL=$(python3 -c "
import yaml
try:
    with open('$CONFIG') as f:
        cfg = yaml.safe_load(f)
    print(cfg.get('brakes',{}).get('heartbeat_max_age_min',240))
except: print(240)
" 2>/dev/null) || VAL=240
    HEARTBEAT_MAX=$VAL
fi

# ═══════════════════════════════════════════════════════════════════════
# 1. STATUS.md 活跃性检查（静默死亡检测）
# ═══════════════════════════════════════════════════════════════════════
if [[ -f "$STATUS_FILE" ]]; then
    STATUS_AGE=$(( $(date +%s) - $(stat -c %Y "$STATUS_FILE" 2>/dev/null || date +%s) ))
    STATUS_AGE_MIN=$(( STATUS_AGE / 60 ))
    if [[ $STATUS_AGE_MIN -gt $HEARTBEAT_MAX ]]; then
        WARNINGS="$WARNINGS\n  ⚠️ STATUS.md ${STATUS_AGE_MIN} 分钟未更新（上限: $HEARTBEAT_MAX）— 可能静默死亡"
    fi
else
    WARNINGS="$WARNINGS\n  ⚠️ STATUS.md 不存在"
fi

# ═══════════════════════════════════════════════════════════════════════
# 2. In Progress 数量检查（thrashing 检测）
# ═══════════════════════════════════════════════════════════════════════
if [[ -f "$STATUS_FILE" ]]; then
    # 只统计 In Progress 区域的未完成项（使用 - [ ] 格式，不匹配 Next 区域的 - [P0] 格式）
    IN_PROGRESS=$(sed -n '/## 🏃 In Progress/,/## /p' "$STATUS_FILE" 2>/dev/null | grep -cE '^\s*- \[\s*\]' || echo 0)
    IN_PROGRESS="${IN_PROGRESS//[^0-9]/}"
    IN_PROGRESS="${IN_PROGRESS:-0}"
    if [[ "$IN_PROGRESS" -gt 3 ]]; then
        WARNINGS="$WARNINGS\n  ⚠️ STATUS.md 中 In Progress 项过多 ($IN_PROGRESS 项) — 可能 thrashing"
    fi
fi

# ═══════════════════════════════════════════════════════════════════════
# 3. Learning inbox 积压检查
# ═══════════════════════════════════════════════════════════════════════
if [[ -d "$INBOX_DIR" ]]; then
    PENDING=0
    if compgen -G "$INBOX_DIR"/*.json > /dev/null 2>&1; then
        PENDING=$(grep -l '"pending"' "$INBOX_DIR"/*.json 2>/dev/null | wc -l || echo 0)
    fi
    PENDING="${PENDING//[^0-9]/}"
    PENDING="${PENDING:-0}"
    if [[ "$PENDING" -gt 5 ]]; then
        WARNINGS="$WARNINGS\n  💡 learning inbox 有 $PENDING 条 pending — 建议运行 /learning skill"
    elif [[ $PENDING -gt 0 ]]; then
        echo "[heartbeat] 💡 learning inbox 有 $PENDING 条 pending 错误可处理" >&2
    fi
fi

# ═══════════════════════════════════════════════════════════════════════
# 4. LEARNINGS.md 统计
# ═══════════════════════════════════════════════════════════════════════
if [[ -f "$LEARNINGS_FILE" ]]; then
    PATTERN_COUNT=$(grep -c '^| P[0-9]' "$LEARNINGS_FILE" 2>/dev/null || echo 0)
    GOTCHA_COUNT=$(grep -c '^| G[0-9]' "$LEARNINGS_FILE" 2>/dev/null || echo 0)
    FIX_COUNT=$(grep -c '^| F[0-9]' "$LEARNINGS_FILE" 2>/dev/null || echo 0)
    echo "[heartbeat] LEARNINGS.md: ${PATTERN_COUNT}P ${GOTCHA_COUNT}G ${FIX_COUNT}F" >&2
fi

# ═══════════════════════════════════════════════════════════════════════
# 输出（有警告时注入 additionalContext）
# ═══════════════════════════════════════════════════════════════════════
if [[ -n "$WARNINGS" ]]; then
    echo "[heartbeat] ⚠️ 发现问题:$WARNINGS" >&2
    if command -v jq &>/dev/null; then
        CTX="[LoopEngineer SessionStart 健康检查]$WARNINGS"
        jq -nc --arg ctx "$CTX" '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$ctx}}'
    fi
else
    echo "[heartbeat] ✅ 项目健康检查通过" >&2
fi

exit 0
