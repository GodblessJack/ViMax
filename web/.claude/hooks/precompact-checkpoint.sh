#!/usr/bin/env bash
# ── ViMax Web PreCompact Checkpoint (PreCompact Hook) ───────────────────
# 上下文压缩前保存当前工作状态，防止进度丢失
# 设计原则：fail-open，任何错误返回 exit 0
# 来源：LoopEngineer precompact-checkpoint.sh 模板
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHECKPOINT_DIR="$PROJECT_ROOT/.claude/checkpoints"
mkdir -p "$CHECKPOINT_DIR"

# ── 读取 stdin JSON ──
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
TIMESTAMP=$(date -Iseconds)
SAFE_SID=$(echo "$SESSION_ID" | tr -dc 'a-zA-Z0-9_-' | head -c 16)

CHECKPOINT_FILE="$CHECKPOINT_DIR/${SAFE_SID}_${TIMESTAMP}.json"

# ── 收集状态 ──
BRANCH="unknown"
COMMIT="unknown"
COMMIT_MSG="unknown"

if command -v git &>/dev/null; then
    cd "$PROJECT_ROOT"
    BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
    COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    COMMIT_MSG=$(git log -1 --format=%s 2>/dev/null || echo "unknown")
fi

MODIFIED=$(cd "$PROJECT_ROOT" && git diff --name-only 2>/dev/null | head -20 | tr '\n' ',' | sed 's/,$//')
STAGED=$(cd "$PROJECT_ROOT" && git diff --staged --name-only 2>/dev/null | head -20 | tr '\n' ',' | sed 's/,$//')

# ── 写入 checkpoint JSON ──
cat > "$CHECKPOINT_FILE" << EOF
{
  "timestamp": "$TIMESTAMP",
  "session_id": "$SESSION_ID",
  "git": {
    "branch": "$BRANCH",
    "commit": "$COMMIT",
    "commit_message": "$COMMIT_MSG",
    "modified_files": "$MODIFIED",
    "staged_files": "$STAGED"
  },
  "project_root": "$PROJECT_ROOT"
}
EOF

echo "[checkpoint] ✅ saved: $CHECKPOINT_FILE (branch=$BRANCH, commit=$COMMIT)" >&2

# ── 清理旧 checkpoint（保留最近 30 个） ──
ls -1t "$CHECKPOINT_DIR"/*.json 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true

exit 0
