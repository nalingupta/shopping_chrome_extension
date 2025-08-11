#!/usr/bin/env bash
set -euo pipefail

# One-click Vertex AI sanity checker
# Usage: ./scripts/vertex_oneclick_check.sh <PROJECT_ID> <LOCATION>
# Auth modes supported:
#   - ADC (gcloud auth application-default login)
#   - Service Account (export GOOGLE_APPLICATION_CREDENTIALS=/abs/path/sa.json)
#   - Express Mode API key (export VERTEX_API_KEY=XXXX)

PROJECT_ID=${1:-}
LOCATION=${2:-}
if [[ -z "${PROJECT_ID}" || -z "${LOCATION}" ]]; then
  echo "Usage: $0 <PROJECT_ID> <LOCATION>" >&2
  exit 2
fi

BASE="https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google"
LIST_URL="${BASE}/models"

# Candidate versioned models to try
CANDIDATE_MODELS=(
  "gemini-1.5-flash-002"
  "gemini-1.5-pro-002"
  "gemini-2.0-flash-001"
  "gemini-2.0-flash-live-001"
)

have() { command -v "$1" >/dev/null 2>&1; }

AUTH_MODE=""
AUTH_HEADER=()
CONTENT_HEADER=( -H "Content-Type: application/json" )

# Prefer ADC if available
ACCESS_TOKEN=""
if have gcloud; then
  ACCESS_TOKEN=$(gcloud auth application-default print-access-token 2>/dev/null || true)
  # If ADC token is not available but a service account key is provided, activate it
  if [[ -z "${ACCESS_TOKEN}" && -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" && -f "${GOOGLE_APPLICATION_CREDENTIALS}" ]]; then
    gcloud auth application-default activate-service-account --key-file="${GOOGLE_APPLICATION_CREDENTIALS}" >/dev/null 2>&1 || true
    ACCESS_TOKEN=$(gcloud auth application-default print-access-token 2>/dev/null || true)
  fi
fi

if [[ -n "${ACCESS_TOKEN}" ]]; then
  AUTH_MODE="ADC"
  AUTH_HEADER=( -H "Authorization: Bearer ${ACCESS_TOKEN}" )
elif [[ -n "${VERTEX_API_KEY:-}" ]]; then
  AUTH_MODE="API_KEY"
  LIST_URL+="?key=${VERTEX_API_KEY}"
  CONTENT_HEADER+=( -H "x-goog-user-project: ${PROJECT_ID}" )
else
  echo "No credentials detected. Use ADC (gcloud auth application-default login) or set VERTEX_API_KEY." >&2
  exit 3
fi

echo "Auth mode: ${AUTH_MODE}"
echo "Project: ${PROJECT_ID}  Location: ${LOCATION}"

echo "\n== Listing Google publisher models (first 5) =="
set +e
LIST_RESP=$(curl -sS "${AUTH_HEADER[@]}" "${LIST_URL}" | cat)
RC=$?
set -e
if [[ ${RC} -ne 0 ]]; then
  echo "List request failed (exit ${RC})." >&2
  exit 4
fi
if have jq; then
  COUNT=$(echo "${LIST_RESP}" | jq '.models | length' 2>/dev/null || echo "-1")
  echo "models count: ${COUNT}"
  echo "${LIST_RESP}" | jq -r '.models[] | "- \(.name) — \(.displayName)"' || true
else
  echo "${LIST_RESP}" | sed -n '1,40p'
fi

echo "\n== generateContent smoke tests =="
SUCCESS_MODEL=""
for MID in "${CANDIDATE_MODELS[@]}"; do
  [[ -z "$MID" ]] && continue
  GEN_URL="${BASE}/models/${MID}:generateContent"
  if [[ "${AUTH_MODE}" == "API_KEY" ]]; then
    GEN_URL+="?key=${VERTEX_API_KEY}"
  fi
  PAYLOAD='{"contents":[{"role":"user","parts":[{"text":"Say hi in one word"}]}]}'
  set +e
  RESP=$(curl -sS "${AUTH_HEADER[@]}" "${CONTENT_HEADER[@]}" -d "${PAYLOAD}" "${GEN_URL}" | cat)
  CODE=$?
  set -e
  if [[ ${CODE} -ne 0 ]]; then
    echo "${MID}: ERROR (curl exit ${CODE})"
    continue
  fi
  if have jq; then
    TXT=$(echo "${RESP}" | jq -r '.candidates[0].content.parts[0].text // empty')
    ERR=$(echo "${RESP}" | jq -r '.error.message // empty')
    if [[ -n "${TXT}" ]]; then
      echo "${MID}: OK -> ${TXT}"
      SUCCESS_MODEL=${MID}
      break
    else
      echo "${MID}: ERROR -> ${ERR:-no text}" | sed 's/\n/ /g'
    fi
  else
    echo "${MID}: Raw response:"; echo "${RESP}" | sed -n '1,40p'
  fi
done

echo "\nSummary:"
if [[ -n "${SUCCESS_MODEL}" ]]; then
  echo "Success with model: ${SUCCESS_MODEL}"
  exit 0
else
  echo "No candidate model returned text. Check IAM (Vertex AI User), billing, region, or model availability."
  exit 6
fi


