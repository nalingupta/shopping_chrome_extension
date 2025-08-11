#!/usr/bin/env bash
set -euo pipefail

# Vertex AI sanity checker for auth and basic text generation
# Usage:
#   ./scripts/vertex_sanity.sh <PROJECT_ID> <LOCATION>
# Env:
#   ADC flow (recommended):
#     gcloud auth application-default login
#   or Service Account:
#     export GOOGLE_APPLICATION_CREDENTIALS=/abs/path/sa.json
#   or Express Mode API key:
#     export VERTEX_API_KEY=XXXX

PROJECT_ID=${1:-}
LOCATION=${2:-}
MODEL_ID_DEFAULT="gemini-1.5-flash"

if [[ -z "$PROJECT_ID" || -z "$LOCATION" ]]; then
  echo "Usage: $0 <PROJECT_ID> <LOCATION>" >&2
  exit 2
fi

BASE="https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google"
LIST_URL="${BASE}/models"
GEN_URL="${BASE}/models/${MODEL_ID_DEFAULT}:generateContent"

have_cmd() { command -v "$1" >/dev/null 2>&1; }

HEADER_CONTENT=( -H "Content-Type: application/json" )

AUTH_MODE=""
AUTH_ARGS=()

if [[ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]] || have_cmd gcloud; then
  # Try ADC first
  if have_cmd gcloud; then
    ACCESS_TOKEN=$(gcloud auth application-default print-access-token 2>/dev/null || true)
  else
    ACCESS_TOKEN=""
  fi
  if [[ -n "$ACCESS_TOKEN" ]]; then
    AUTH_MODE="ADC"
    AUTH_ARGS=( -H "Authorization: Bearer ${ACCESS_TOKEN}" )
  fi
fi

if [[ -z "$AUTH_MODE" && -n "${VERTEX_API_KEY:-}" ]]; then
  AUTH_MODE="API_KEY"
  # Append key on URL; also include user-project header
  LIST_URL+="?key=${VERTEX_API_KEY}"
  GEN_URL+="?key=${VERTEX_API_KEY}"
  HEADER_CONTENT+=( -H "x-goog-user-project: ${PROJECT_ID}" )
fi

if [[ -z "$AUTH_MODE" ]]; then
  echo "No credentials detected. Set ADC (gcloud auth application-default login) or VERTEX_API_KEY." >&2
  exit 3
fi

echo "Auth mode: ${AUTH_MODE}"
echo "Project: ${PROJECT_ID}  Location: ${LOCATION}"

echo "\n== List Google publisher models =="
set +e
LIST_RESP=$(curl -sS "${LIST_URL}" "${AUTH_ARGS[@]}" | cat)
LIST_CODE=$?
set -e
if [[ $LIST_CODE -ne 0 ]]; then
  echo "List request failed (exit ${LIST_CODE}). Raw output:" >&2
  echo "$LIST_RESP"
  exit 4
fi

if have_cmd jq; then
  COUNT=$(echo "$LIST_RESP" | jq '.models | length' 2>/dev/null || echo "-1")
  echo "models count: ${COUNT}"
  echo "$LIST_RESP" | jq -r '.models[0:5][] | "- \(.name) — \(.displayName)"' || true
else
  echo "$LIST_RESP" | sed -n '1,40p'
fi

echo "\n== generateContent smoke test (${MODEL_ID_DEFAULT}) =="
PAYLOAD='{"contents":[{"role":"user","parts":[{"text":"Say hi in one word"}]}]}'
set +e
GEN_RESP=$(curl -sS "${GEN_URL}" "${AUTH_ARGS[@]}" "${HEADER_CONTENT[@]}" -d "$PAYLOAD" | cat)
GEN_CODE=$?
set -e
if [[ $GEN_CODE -ne 0 ]]; then
  echo "generateContent failed (exit ${GEN_CODE}). Raw output:" >&2
  echo "$GEN_RESP"
  exit 5
fi

if have_cmd jq; then
  TXT=$(echo "$GEN_RESP" | jq -r '.candidates[0].content.parts[0].text // empty')
  if [[ -n "$TXT" ]]; then
    echo "OK: $TXT"
  else
    echo "No text in response. Raw excerpt:"
    echo "$GEN_RESP" | jq -r '.' | sed -n '1,60p'
  fi
else
  echo "$GEN_RESP" | sed -n '1,60p'
fi

echo "\nDone."


