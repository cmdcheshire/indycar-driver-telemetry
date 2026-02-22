#!/bin/bash
# Seed a template JSON file into the running server via the REST API.
#
# Usage:
#   ./tools/seed-template.sh templates/indycar-27-car-leaderboard.json
#   ./tools/seed-template.sh templates/indycar-27-car-leaderboard.json http://localhost:4000
#
# Requires: curl, jq (optional, for pretty output)
#
# The script logs in with default admin credentials, then POSTs the template.

set -euo pipefail

TEMPLATE_FILE="${1:?Usage: seed-template.sh <template.json> [base_url]}"
BASE_URL="${2:-http://localhost:3000}"

if [ ! -f "$TEMPLATE_FILE" ]; then
  echo "Error: Template file not found: $TEMPLATE_FILE"
  exit 1
fi

echo "Seeding template from: $TEMPLATE_FILE"
echo "Server: $BASE_URL"

# 1. Login to get JWT token
echo "Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin"}')

TOKEN=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null || echo "")

if [ -z "$TOKEN" ]; then
  echo "Error: Failed to login. Response:"
  echo "$LOGIN_RESPONSE"
  exit 1
fi

echo "Login successful."

# 2. POST the template
echo "Creating template..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/overlays/templates" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d @"$TEMPLATE_FILE")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "201" ]; then
  echo "Template seeded successfully!"
  # Try pretty-print with python3
  echo "$BODY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
t = data.get('template', data)
print(f\"  ID:   {t.get('id', '?')}\")
print(f\"  Name: {t.get('name', '?')}\")
print(f\"  Type: {t.get('overlay_type', '?')}\")
els = json.loads(t.get('template_data', '{}')).get('elements', []) if isinstance(t.get('template_data'), str) else t.get('template_data', {}).get('elements', [])
print(f\"  Elements: {len(els)}\")
" 2>/dev/null || echo "$BODY"
else
  echo "Error: HTTP $HTTP_CODE"
  echo "$BODY"
  exit 1
fi
