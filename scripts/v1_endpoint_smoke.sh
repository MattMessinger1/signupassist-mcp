#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-}"
if [[ -z "${BASE_URL}" ]]; then
  echo "Usage: $0 <base_url>"
  echo "Example: $0 https://signupassist-mcp-production.up.railway.app"
  exit 1
fi

echo "== SignupAssist v1 endpoint smoke =="
echo "BASE_URL=${BASE_URL}"

get_status () {
  local path="$1"
  local url="${BASE_URL}${path}"
  curl -sS -o /dev/null -w "%{http_code}" "${url}" || echo "000"
}

check_get () {
  local path="$1"
  local url="${BASE_URL}${path}"
  local hdr
  local body
  hdr="$(mktemp)"
  body="$(mktemp)"
  echo ""
  echo "=== GET ${path} ==="
  curl -sS -D "${hdr}" -o "${body}" "${url}"
  head -n 20 "${hdr}"
  echo "(body head)"
  head -n 12 "${body}"
  rm -f "${hdr}" "${body}"
}

check_head () {
  local path="$1"
  echo ""
  echo "=== HEAD ${path} ==="
  curl -sS -I "${BASE_URL}${path}" | head -n 20
}

check_post_json () {
  local path="$1"
  local json="$2"
  local url="${BASE_URL}${path}"
  local hdr
  local body
  hdr="$(mktemp)"
  body="$(mktemp)"
  echo ""
  echo "=== POST ${path} ==="
  echo "payload: ${json}"
  curl -sS -D "${hdr}" -o "${body}" -H 'Content-Type: application/json' -X POST "${url}" --data "${json}"
  head -n 25 "${hdr}"
  echo "(body head)"
  head -n 40 "${body}"
  rm -f "${hdr}" "${body}"
}

check_get "/health"
check_get "/.well-known/chatgpt-apps-manifest.json"
check_get "/.well-known/oauth-authorization-server"
check_get "/docs"
check_get "/privacy"
check_get "/terms"
check_head "/logo-512.svg"

echo ""
echo "== Legacy OpenAPI surfaces (200 in legacy mode, 410 in MCP-only mode) =="
OPENAPI_1="$(get_status "/mcp/openapi.json")"
OPENAPI_2="$(get_status "/.well-known/openapi.json")"
echo "Status /mcp/openapi.json: ${OPENAPI_1}"
echo "Status /.well-known/openapi.json: ${OPENAPI_2}"
check_get "/mcp/openapi.json"
check_get "/.well-known/openapi.json"

echo ""
echo "== Legacy /orchestrator/chat checks (skipped in MCP-only mode) =="
ORCH_STATUS="$(get_status "/orchestrator/chat")"
echo "Status /orchestrator/chat: ${ORCH_STATUS}"

echo ""
if [[ "${ORCH_STATUS}" == "410" ]]; then
  echo "MCP-only mode detected (410). Skipping legacy /orchestrator/chat action checks."
else
  echo "== OAuth gating check (expect 401) =="
  check_post_json "/orchestrator/chat" '{"message":"","sessionId":"smoke-1","action":"view_receipts"}'

  echo ""
  echo "== Public action check (expect 200) =="
  check_post_json "/orchestrator/chat" '{"message":"","sessionId":"smoke-1","action":"clear_context"}'
fi

echo ""
echo "✅ endpoint smoke complete"


