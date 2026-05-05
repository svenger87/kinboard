#!/usr/bin/env bash
# 5-bringup-app.sh — start the demo webapp + mock servers once data is anonymized.
#
# Pre-reqs: 2-bringup.sh (postgres + supabase up), 3-restore.sh (data
# loaded), 4-anonymize.mjs (PII scrubbed), 4b-seed-extras.mjs (notes+todos).
#
# Brings up the webapp container + the three mock servers (HA, Tesla, go2rtc).
# Idempotent.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCREENSHOT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

cd "$SCREENSHOT_ROOT"
set -a
# shellcheck disable=SC1091
source ./demo.env
DATA_DIR="$SCREENSHOT_ROOT/data"
export DATA_DIR
export SCREENSHOT_ROOT
export REPO_ROOT
set +a

PROJECT_NAME="${PROJECT_NAME:-kinboard-demo}"
WEBAPP_PORT="${WEBAPP_PORT:-3201}"

# -----------------------------------------------------------------
# Make sure mock node_modules exist (cheap to install — ~50 packages)
# -----------------------------------------------------------------
for mock in mocks/ha mocks/tesla; do
  if [[ ! -d "$mock/node_modules" && -f "$mock/package.json" ]]; then
    echo "Installing deps for $mock…"
    (cd "$mock" && npm install --silent --no-audit --no-fund) || {
      echo "warning: npm install failed in $mock — mock may not start." >&2
    }
  fi
done

# -----------------------------------------------------------------
# Bring up webapp + mocks (db etc. should already be up from step 2)
# -----------------------------------------------------------------
echo ""
echo "Bringing up webapp + mock servers…"

docker compose \
  -f "$REPO_ROOT/webapp/docker/docker-compose.yml" \
  -f docker-compose.override.yml \
  --env-file demo.env \
  --project-directory "$REPO_ROOT/webapp/docker" \
  --project-name "$PROJECT_NAME" \
  up -d --build webapp mock-ha mock-tesla mock-go2rtc

# -----------------------------------------------------------------
# Wait for webapp ready
# -----------------------------------------------------------------
echo ""
echo "Waiting for webapp on http://localhost:${WEBAPP_PORT} …"
for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${WEBAPP_PORT}/" || echo "000")
  if [[ "$code" == "200" || "$code" == "302" || "$code" == "307" ]]; then
    echo "  Webapp responding (HTTP $code)."
    break
  fi
  sleep 1
  if [[ $i -eq 90 ]]; then
    echo "  timeout: webapp not responding after 90s."
    docker compose --project-name "$PROJECT_NAME" logs --tail=30 webapp >&2 || true
    exit 2
  fi
done

# -----------------------------------------------------------------
# Status + URLs
# -----------------------------------------------------------------
echo ""
echo "Demo stack ready:"
echo "  Kinboard:   http://localhost:${WEBAPP_PORT}/"
echo "  Mock HA:       http://localhost:8123/api/"
echo "  Mock Tesla:    http://localhost:8124/api/"
echo "  Mock go2rtc:   http://localhost:1984/"
echo ""
JOIN_CODE=$(docker exec "${PROJECT_NAME}-db" psql -U postgres -d postgres -tAc \
  "SELECT join_code FROM public.families LIMIT 1" 2>/dev/null || echo "?")
echo "  Demo join code: $JOIN_CODE"
echo ""
echo "Next: npm run capture   # Playwright walks every wiki page"
