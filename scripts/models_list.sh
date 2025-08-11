#!/usr/bin/env bash
set -euo pipefail

# List available models for either:
# - AI Studio (GOOGLE_API_KEY)
# - Vertex AI (ADC via gcloud or VERTEX_API_KEY with x-goog-user-project)
#
# Usage examples:
#   # AI Studio
#   export GOOGLE_API_KEY=xxxx
#   ./scripts/models_list.sh
#
#   # Vertex
#   ./scripts/models_list.sh <PROJECT_ID> <LOCATION>

have() { command -v "$1" >/dev/null 2>&1; }

PROJECT_ID=${1:-}
LOCATION=${2:-us-central1}

if [[ -n "${GOOGLE_API_KEY:-}" && -z "${PROJECT_ID}" ]]; then
  # AI Studio listing
  URL="https://generativelanguage.googleapis.com/v1beta/models?key=${GOOGLE_API_KEY}"
  echo "Mode: AI Studio (API key)"
  echo "GET ${URL}"
  set +e
  RESP=$(curl -sS "${URL}" | cat)
  RC=$?
  set -e
  if [[ ${RC} -ne 0 ]]; then
    echo "curl failed with exit code ${RC}" >&2
    exit 3
  fi
  if have jq; then
    echo "All models:" && echo "${RESP}" | jq -r '.models[] | "- \(.name) — \(.displayName)"' || true
  else
    echo "${RESP}" | sed -n '1,120p'
  fi
  exit 0
fi

# Vertex AI listing
if [[ -z "${PROJECT_ID}" ]]; then
  echo "Usage for Vertex: $0 <PROJECT_ID> [LOCATION]" >&2
  exit 2
fi

AUTH_HEADER=()
ACCESS_TOKEN=""
if have gcloud; then
  ACCESS_TOKEN=$(gcloud auth application-default print-access-token 2>/dev/null || true)
  if [[ -z "${ACCESS_TOKEN}" && -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" && -f "${GOOGLE_APPLICATION_CREDENTIALS}" ]]; then
    gcloud auth application-default activate-service-account --key-file="${GOOGLE_APPLICATION_CREDENTIALS}" >/dev/null 2>&1 || true
    ACCESS_TOKEN=$(gcloud auth application-default print-access-token 2>/dev/null || true)
  fi
fi

if [[ -n "${ACCESS_TOKEN}" ]]; then
  AUTH_HEADER=( -H "Authorization: Bearer ${ACCESS_TOKEN}" )
elif [[ -n "${VERTEX_API_KEY:-}" ]]; then
  AUTH_HEADER=( -H "x-goog-user-project: ${PROJECT_ID}" )
  echo "Note: Using VERTEX_API_KEY; ensure you append ?key=... to the URL."
else
  echo "No ADC token or VERTEX_API_KEY found. Set GOOGLE_APPLICATION_CREDENTIALS and/or run 'gcloud auth application-default login'." >&2
  exit 4
fi

BASE="https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models"
URL="${BASE}"
if [[ -n "${VERTEX_API_KEY:-}" && -z "${ACCESS_TOKEN}" ]]; then
  URL+="?key=${VERTEX_API_KEY}"
fi

echo "Mode: Vertex AI"
echo "Project: ${PROJECT_ID}  Location: ${LOCATION}"
echo "GET ${URL}"

set +e
RESP=$(curl -sS "${AUTH_HEADER[@]}" "${URL}" | cat)
RC=$?
set -e
if [[ ${RC} -ne 0 ]]; then
  echo "curl failed with exit code ${RC}" >&2
  exit 5
fi
if have jq; then
  echo "All publisher models:" && echo "${RESP}" | jq -r '.models[] | "- \(.name) — \(.displayName)"' || true
else
  echo "${RESP}" | sed -n '1,120p'
fi


