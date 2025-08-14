#!/usr/bin/env zsh
set -euo pipefail

# Defaults (override via env or flags)
# Use BIND_HOST to avoid collision with zsh's built-in $HOST variable
BIND_HOST="${BIND_HOST:-127.0.0.1}"
PORT="${PORT:-8787}"
RELOAD="${RELOAD:-1}"
UVICORN_LOG_LEVEL="${UVICORN_LOG_LEVEL:-debug}"
SERVER_LOG_LEVEL="${SERVER_LOG_LEVEL:-INFO}"
CONDA_ENV="${CONDA_ENV:-shopping-chrome-ext}"
RESTART="${RESTART:-0}"
PYTHONUNBUFFERED=1

print_usage() {
  echo "Usage: $0 [--host HOST] [--port PORT] [--reload|--no-reload] [--log-level LEVEL] [--restart] [--conda-env NAME]"
}

# Parse flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) BIND_HOST="${2:-}"; shift 2;;
    --port) PORT="${2:-}"; shift 2;;
    --reload) RELOAD="1"; shift;;
    --no-reload) RELOAD="0"; shift;;
    --log-level) UVICORN_LOG_LEVEL="${2:-}"; shift 2;;
    --restart) RESTART="1"; shift;;
    --conda-env) CONDA_ENV="${2:-}"; shift 2;;
    -h|--help) print_usage; exit 0;;
    *) echo "Unknown option: $1"; print_usage; exit 1;;
  esac
done

# Repo root
cd "$(dirname "$0")/.."

# Optionally free the port
if [[ "${RESTART}" == "1" ]]; then
  lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t 2>/dev/null | xargs -r kill || true
fi

# Choose Python runner (prefer conda if available)
PYTHON_CMD=""
if command -v conda >/dev/null 2>&1 && conda env list | grep -q "^${CONDA_ENV}\b"; then
  PYTHON_CMD="conda run -n ${CONDA_ENV} --no-capture-output python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_CMD="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_CMD="python"
else
  echo "No Python found. Install Python or ensure it is on PATH." >&2
  exit 1
fi

# Ensure uvicorn is available
if ! ${=PYTHON_CMD} -c 'import uvicorn' >/dev/null 2>&1; then
  echo "uvicorn not found in the selected environment. Install: pip install uvicorn[standard] fastapi" >&2
  exit 1
fi

# Build uvicorn args
RELOAD_ARG=()
if [[ "${RELOAD}" == "1" ]]; then
  RELOAD_ARG=(--reload)
fi

# Start server
exec env SERVER_LOG_LEVEL="${SERVER_LOG_LEVEL}" PYTHONUNBUFFERED="${PYTHONUNBUFFERED}" \
  ${=PYTHON_CMD} -m uvicorn server.main:app \
  --host "${BIND_HOST}" \
  --port "${PORT}" \
  --log-level "${UVICORN_LOG_LEVEL}" \
  ${RELOAD_ARG[@]}


