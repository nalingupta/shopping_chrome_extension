#!/usr/bin/env zsh
set -euo pipefail

run_server() {
  # Optionally free the port if occupied
  lsof -nP -iTCP:8787 -sTCP:LISTEN -t 2>/dev/null | xargs -r kill || true
  # Run from repo root
  cd /Users/subham/Desktop/codes/wextension/shopping_chrome_extension
  exec "${1}" -m uvicorn server.main:app --host 127.0.0.1 --port 8787 --reload
}

# Prefer conda env if available; otherwise fall back to system Python
if command -v conda >/dev/null 2>&1; then
  eval "$(conda shell.zsh hook)"
  if conda env list | grep -q "^shopping-chrome-ext\b"; then
    conda activate shopping-chrome-ext
    run_server python
  else
    echo "Conda found but env 'shopping-chrome-ext' missing. Using system Python." >&2
  fi
fi

# Fallback to system Python
if command -v python >/dev/null 2>&1 && python -c 'import uvicorn' >/dev/null 2>&1; then
  run_server python
elif command -v python3 >/dev/null 2>&1 && python3 -c 'import uvicorn' >/dev/null 2>&1; then
  run_server python3
else
  echo "Could not find uvicorn in Python or Python3. Install with: pip install uvicorn[standard] fastapi" >&2
  exit 1
fi


