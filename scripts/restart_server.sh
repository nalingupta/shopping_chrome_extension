#!/usr/bin/env zsh
set -euo pipefail

# Usage: CAPTURE_FPS=1 ./scripts/restart_server.sh
# Defaults CAPTURE_FPS to 1 if not provided

export CAPTURE_FPS=${CAPTURE_FPS:-1}

# Kill anything on port 8787
lsof -nP -iTCP:8787 -sTCP:LISTEN -t 2>/dev/null | xargs -r kill || true

# Activate conda env if available
if command -v conda >/dev/null 2>&1; then
  eval "$(conda shell.zsh hook)"
  if conda env list | grep -q "^shopping-chrome-ext\b"; then
    conda activate shopping-chrome-ext
  fi
fi

cd "$(dirname "$0")/.."
echo "Starting backend with CAPTURE_FPS=${CAPTURE_FPS}"
exec env CAPTURE_FPS="${CAPTURE_FPS}" python -m uvicorn server.main:app --host 127.0.0.1 --port 8787 --reload


