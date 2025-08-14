#!/usr/bin/env zsh
set -euo pipefail

# Thin wrapper to unified server script with restart behavior
export CAPTURE_FPS=${CAPTURE_FPS:-1}
SCRIPT_DIR="$(dirname "$0")"
cd "${SCRIPT_DIR}/.."
echo "Starting backend with CAPTURE_FPS=${CAPTURE_FPS}"
exec env CAPTURE_FPS="${CAPTURE_FPS}" zsh "${SCRIPT_DIR}/server.sh" --reload --log-level debug --restart


