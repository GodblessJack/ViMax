#!/usr/bin/env bash
# ViMax Web Backend Launcher — clears proxy before starting
# The SOCKS proxy (ALL_PROXY=socks://127.0.0.1:7890/) breaks
# LangChain ChatOpenAI which doesn't support SOCKS.
set -e
cd "$(dirname "$0")/.."

echo "Clearing proxy env vars..."
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset http_proxy https_proxy all_proxy no_proxy NO_PROXY

export PYTHONPATH="$(pwd)"
exec .venv/bin/python -m uvicorn web.backend.main:app \
  --host 0.0.0.0 --port 8000 "$@"
