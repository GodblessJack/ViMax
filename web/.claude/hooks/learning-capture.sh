#!/usr/bin/env bash
# ── ViMax Web Learning Capture (StopFailure + PostToolUse Hook) ─────────
# 捕获失败并写入学习 inbox，供 learning SKILL 后续提炼
# 设计原则：fail-open，dedup 10 分钟内的重复错误
# 来源：LoopEngineer learning-capture.sh 模板
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INBOX_DIR="$PROJECT_ROOT/.claude/learnings/inbox"
STATE_DIR="$HOME/.claude/state"
mkdir -p "$INBOX_DIR" "$STATE_DIR"

# ── 读取 stdin JSON ──
INPUT=$(cat)
HOOK_EVENT=$(echo "$INPUT" | jq -r '.hook_event // ""')
EXIT_CODE=$(echo "$INPUT" | jq -r '.exit_code // "0"')
REASON=$(echo "$INPUT" | jq -r '.reason // ""' | head -c 200)
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript // ""' | tail -c 500 | head -c 300)

# ── 决定是否捕获 ──
# StopFailure: API 错误等导致的停止
# PostToolUse exit code 2: maker-checker 验证失败
SHOULD_CAPTURE=false
FAILURE_TYPE=""

if [[ "$HOOK_EVENT" == "StopFailure" ]]; then
    SHOULD_CAPTURE=true
    FAILURE_TYPE="api_error"
elif [[ "$HOOK_EVENT" == "PostToolUse" && "$EXIT_CODE" == "2" ]]; then
    SHOULD_CAPTURE=true
    FAILURE_TYPE="verification_failure"
fi

if [[ "$SHOULD_CAPTURE" != "true" ]]; then
    exit 0
fi

# ── Dedup: 相同错误 10 分钟内不重复捕获 ──
REASON_HASH=$(echo "$REASON" | md5sum | cut -d' ' -f1 | head -c 8)
STAMP_FILE="$STATE_DIR/lc-$REASON_HASH"

if [[ -f "$STAMP_FILE" ]]; then
    LAST_TIME=$(cat "$STAMP_FILE" 2>/dev/null || echo 0)
    NOW=$(date +%s)
    ELAPSED=$((NOW - LAST_TIME))
    if [[ $ELAPSED -lt 600 ]]; then
        echo "[learning-capture] SKIP: 相同错误 ${ELAPSED}s 前已捕获 (dedup window: 600s)" >&2
        exit 0
    fi
fi

date +%s > "$STAMP_FILE"

# ── 写入 inbox ──
HASH8=$(echo "$REASON$FAILURE_TYPE$(date +%s)" | md5sum | cut -d' ' -f1 | head -c 8)
CAPTURE_FILE="$INBOX_DIR/$(date +%Y%m%d-%H%M%S)-$HASH8.json"

cat > "$CAPTURE_FILE" << EOF
{
  "timestamp": "$(date -Iseconds)",
  "type": "$FAILURE_TYPE",
  "reason": "$REASON",
  "transcript_tail": "$TRANSCRIPT",
  "status": "pending"
}
EOF

# ── 保持 inbox 最多 50 条 ──
INBOX_COUNT=$(ls -1 "$INBOX_DIR"/*.json 2>/dev/null | wc -l)
if [[ $INBOX_COUNT -gt 50 ]]; then
    ls -1t "$INBOX_DIR"/*.json | tail -n +51 | xargs rm -f 2>/dev/null || true
fi

echo "[learning-capture] ✅ captured: $CAPTURE_FILE (type=$FAILURE_TYPE)" >&2
exit 0
