#!/usr/bin/env bash
#
# curl-based integration snippets for Ollama Web API
# Run these against a running server to validate preset functionality
#
# Usage:
#   1. Start the server: npm start
#   2. Run these commands in a separate terminal
#

BASE_URL="${BASE_URL:-http://localhost:3000}"

echo "==> Testing /api/settings (preset cache)"
curl -s "${BASE_URL}/api/settings" | jq '.presets[] | {id, label, version, category}'

echo ""
echo "==> Creating session with preset"
SESSION_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/sessions" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Preset Session",
    "presetId": "default-assistant",
    "instructions": "You are an honest, detail-oriented AI assistant..."
  }')

SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r '.session.id')
echo "Created session: $SESSION_ID"

echo ""
echo "==> Verifying session preset metadata"
curl -s "${BASE_URL}/api/sessions/${SESSION_ID}" | jq '.session | {id, name, presetId}'

echo ""
echo "==> Listing all sessions with preset info"
curl -s "${BASE_URL}/api/sessions" | jq '.sessions[] | {id, name, presetId}'

echo ""
echo "==> Testing chat with preset-based session"
curl -s -X POST "${BASE_URL}/api/chat" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"Hello from preset test\",
    \"sessionId\": \"${SESSION_ID}\"
  }" | jq '{thinking, response: (.response | .[0:100]), sessionId, model}'

echo ""
echo "==> Testing streaming with session preset (first 5 events)"
curl -s -X POST "${BASE_URL}/api/chat/stream" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"Stream test with preset\",
    \"sessionId\": \"${SESSION_ID}\",
    \"includeHistory\": false
  }" | head -5

echo ""
echo "==> Verifying history entry includes preset metadata"
curl -s "${BASE_URL}/api/history?sessionId=${SESSION_ID}" | jq '.history[-1] | {presetId, instructions: (.instructions | .[0:50])}'

echo ""
echo "==> Updating session to different preset"
curl -s -X PUT "${BASE_URL}/api/sessions/${SESSION_ID}" \
  -H "Content-Type: application/json" \
  -d '{
    "presetId": "ai-coder-prompt"
  }' | jq '.session | {id, presetId}'

echo ""
echo "==> Cleanup: deleting test session"
curl -s -X DELETE "${BASE_URL}/api/sessions/${SESSION_ID}"

echo ""
echo "All curl integration tests completed!"
