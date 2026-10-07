#!/usr/bin/env bash
# test-entry-switch.sh — RFC-018's upgrade path, against a running stack.
#
# Takes a stack that runs with Kong as the front door, turns it back into an
# install from before 1.13 (no KINBOARD_ENTRY, no front-door route, the webapp
# on WEBAPP_PORT, a separate API address on Kong's port), and checks:
#
#   1. that layout really is the old one, and a stored relative image path is
#      served by the webapp itself (its /storage passthrough route);
#   2. setup.sh adds the route without moving anything;
#   3. `./start.sh up` moves the install to Kong — after the check — and the
#      app answers through Kong on WEBAPP_PORT, with nothing left behind.
#
# Run from webapp/docker with the same COMPOSE_FILES the stack uses. Used by
# .github/workflows/e2e.yml after the browser suites; it rewrites .env and
# kong.yml, so run it last, on a stack you are about to throw away.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
REPO_ROOT="$(cd ../.. && pwd)"
COMPOSE_FILES="${COMPOSE_FILES:--f docker-compose.yml}"
export COMPOSE_FILES

env_get() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | tr -d '"\r' || true; }
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

PORT="$(env_get WEBAPP_PORT)"; PORT="${PORT:-3001}"
KONG_PORT="$(env_get KONG_HTTP_PORT)"; KONG_PORT="${KONG_PORT:-8100}"
SR="$(env_get SERVICE_ROLE_KEY)"
APP="http://localhost:$PORT"

wait_for() {
  local url="$1" _
  for _ in $(seq 1 90); do
    if curl -sfo /dev/null --max-time 3 "$url"; then return 0; fi
    sleep 5
  done
  return 1
}
via_kong() { curl -s -o /dev/null -D - "$1" | tr -d '\r' | grep -i '^via: .*kong' >/dev/null; }

# A public object to serve through the passthrough.
OBJ="e2e-entry/$(date +%s).png"
curl -sf -X POST "http://localhost:$KONG_PORT/storage/v1/object/recipe-images/$OBJ" \
  -H "apikey: $SR" -H "Authorization: Bearer $SR" -H "Content-Type: image/png" \
  --data-binary @../public/favicon.png >/dev/null || fail "could not upload a test object"

echo "--- turning the stack into a 1.12 install"
sed -i -E '/^[[:space:]]*(export[[:space:]]+)?KINBOARD_ENTRY=/d' .env
sed -i -E "s|^API_EXTERNAL_URL=.*|API_EXTERNAL_URL=http://localhost:$KONG_PORT|; s|^SITE_URL=.*|SITE_URL=$APP|; s|^ADDITIONAL_REDIRECT_URLS=.*|ADDITIONAL_REDIRECT_URLS=$APP|" .env
grep -v -F '# kinboard_entry' kong.yml > kong.yml.old && cat kong.yml.old > kong.yml && rm -f kong.yml.old
# shellcheck disable=SC2086
docker compose $COMPOSE_FILES up -d >/dev/null 2>&1
# shellcheck disable=SC2086
docker compose $COMPOSE_FILES restart kong >/dev/null 2>&1
wait_for "$APP/api/health" || fail "the old layout never answered on $PORT"

via_kong "$APP/api/health" && fail "port $PORT is still Kong in the old layout"
pass "the webapp answers on $PORT itself"
code="$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$APP/storage/v1/object/public/recipe-images/$OBJ")"
[[ "$code" == "200 image/png" ]] || fail "relative image through the webapp: $code"
via_kong "$APP/storage/v1/object/public/recipe-images/$OBJ" && fail "the image came from Kong, not the webapp"
pass "the webapp serves a relative image path itself (200 image/png)"

echo "--- setup.sh"
before_env="$(cksum < .env)"
(cd "$REPO_ROOT" && ./setup.sh --non-interactive >/dev/null)
grep -F '# kinboard_entry' kong.yml >/dev/null || fail "setup.sh did not add the route"
[[ -z "$(env_get KINBOARD_ENTRY)" ]] || fail "setup.sh moved the install itself"
[[ "$(cksum < .env)" == "$before_env" ]] || fail "setup.sh changed .env"
pass "setup.sh added the route and left .env alone"

echo "--- ./start.sh up"
out="$(bash start.sh up 2>&1)" || { echo "$out"; fail "start.sh up failed"; }
echo "$out" | grep '^entry:' || true
[[ "$(env_get KINBOARD_ENTRY)" == "kong" ]] || { echo "$out"; fail "the install was not moved to kong"; }
[[ ! -e .env.pre-entry ]] || fail ".env.pre-entry left behind"
wait_for "$APP/api/health" || fail "nothing answers on $PORT after the move"
via_kong "$APP/api/health" || fail "port $PORT is not Kong after the move"
curl -s "$APP/join" | grep -F '"NEXT_PUBLIC_SUPABASE_URL":"same-origin"' >/dev/null \
  || fail "the page does not tell the browser to use its own origin"
code="$(curl -s -o /dev/null -w '%{http_code}' "$APP/storage/v1/object/public/recipe-images/$OBJ")"
[[ "$code" == "200" ]] || fail "relative image through Kong: $code"
pass "moved: Kong answers on $PORT with the app, same-origin, images served"

curl -s -o /dev/null -X DELETE "http://localhost:$KONG_PORT/storage/v1/object/recipe-images/$OBJ" \
  -H "apikey: $SR" -H "Authorization: Bearer $SR" || true
echo "all checks passed"
