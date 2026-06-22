#!/usr/bin/env bash
# ============================================================================
# notify-slack.sh — Notification hook: 需要权限批准时 → Slack 通知
# 来源：LoopEngineer，适配 Slack（替换 Lark）
# 依赖：curl, jq, SLACK_WEBHOOK_URL 环境变量
# 纯通知 exit 0, 含 session 级 60s 防抖
# ============================================================================
set -uo pipefail
command -v curl >/dev/null || exit 0
command -v jq >/dev/null || exit 0

INPUT="$(cat)"
MSG=$(jq -r '.message // "Claude 需要你注意"' <<<"$INPUT")
NTYPE=$(jq -r '.notification_type // "notice"' <<<"$INPUT")
SID=$(jq -r '.session_id // ""' <<<"$INPUT")

# ── Webhook URL 优先级: 环境变量 > loop.config.yaml > 硬编码 ──
WEBHOOK="${SLACK_WEBHOOK_URL:-}"

# 尝试从 loop.config.yaml 读取
if [[ -z "$WEBHOOK" ]]; then
    CONFIG="$(cd "$(dirname "$0")/../.." && pwd)/loop.config.yaml"
    if command -v python3 &>/dev/null && [ -f "$CONFIG" ]; then
        WEBHOOK=$(python3 -c "
import yaml
try:
    with open('$CONFIG') as f:
        cfg = yaml.safe_load(f)
    n = cfg.get('notifications',{})
    print(n.get('slack_webhook_url',''))
except: print('')
" 2>/dev/null) || WEBHOOK=""
    fi
fi

if [[ -z "$WEBHOOK" || "$WEBHOOK" == "null" ]]; then
    echo "[notify-slack] SKIP: SLACK_WEBHOOK_URL 未配置" >&2
    exit 0
fi

# ── 防抖: 同一 session 60s 内只发一次 ──
STATE_DIR="$HOME/.claude/state"; mkdir -p "$STATE_DIR" 2>/dev/null || exit 0
STAMP="$STATE_DIR/notify-slack-$(printf '%s' "${SID:-x}" | sha256sum | cut -d' ' -f1)"
NOW=$(date +%s)
[ -f "$STAMP" ] && { L=$(cat "$STAMP" 2>/dev/null); [ $((NOW-L)) -lt 60 ] && exit 0; }
echo "$NOW" >"$STAMP" 2>/dev/null

# ── 构建 Slack message payload ──
TEXT=":bell: *Claude Code 需要你* [\`$NTYPE\`]
> $MSG
\`\`\`session: ${SID:0:12}…\`\`\`"

PAYLOAD=$(jq -nc --arg text "$TEXT" '{
    text: $text,
    mrkdwn: true
}')

# ── 发送到 Slack ──
curl -s -X POST -H 'Content-Type: application/json' -d "$PAYLOAD" "$WEBHOOK" >/dev/null 2>&1
echo "[notify-slack] ✅ sent: $NTYPE" >&2
exit 0
