#!/usr/bin/env zsh
set -euo pipefail

# Backward-compatible wrapper to the unified server script
SCRIPT_DIR="$(dirname "$0")"
exec zsh "${SCRIPT_DIR}/server.sh" --reload --log-level debug --restart


