#!/usr/bin/env bash
# test-integration-api.sh — exercise the Integration API over HTTP, end to end.
#
# The unit specs cover the rules exhaustively, but they all stop at the
# function boundary. This is the only thing that proves the pieces are actually
# wired together: that a token in the database authenticates a real request,
# that a scope refusal is a 401 on the wire and not just `false` from a helper,
# and — the claim RFC-001's whole architecture rests on — that a write which
# never touches a Next.js route still produces an event a consumer can read.
#
# Runs against the disposable fresh-install rig, never production. It mints its
# own tokens, writes test rows, and tears the whole stack down afterwards.
#
# Usage:
#   ./test-integration-api.sh          # boot, test, tear down
#   KEEP_UP=1 ./test-integration-api.sh  # leave the stack up to poke at

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$SCRIPT_DIR"

RIG_PROJECT="kbfresh"
RIG_DATA="/mnt/user/appdata/kinboard-fresh-data"
RIG_WEBAPP_PORT=3031
RIG_POSTGRES_PORT=5462
RIG_KONG_HTTP_PORT=8130
RIG_KONG_HTTPS_PORT=8573
RIG_GO2RTC_HTTP_PORT=1995
RIG_GO2RTC_WEBRTC_PORT=8585
RIG_NETWORK_SUBNET="10.221.0.0/24"
RIG_DEMO_CODE="FRSH01"

# shellcheck source=test-rig-common.sh
. "$SCRIPT_DIR/test-rig-common.sh"

INSTALL_COMPOSE=(-f docker-compose.yml)
API="$BASE_URL/api/integration/v1"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

chk() { # name actual expected
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (got $2, want $3)"; fi
}

post() { # service key body outfile token
  curl -s -o "$4" -w '%{http_code}' -X POST "$API/services/$1" \
    -H "Authorization: Bearer $5" -H 'Content-Type: application/json' \
    ${2:+-H "Idempotency-Key: $2"} -d "$3"
}

# --------------------------------------------------------------------- setup

say "Booting the disposable stack"
rig_require_free_ports || exit 1
rig_prepare_env
compose INSTALL_COMPOSE build webapp >/dev/null 2>&1 || { fail "build"; exit 1; }
rig_teardown; rm -rf "$RIG_DATA"; mkdir -p "$RIG_DATA"
( cd "$SCRIPT_DIR" && COMPOSE_FILES="-f docker-compose.yml" ./start.sh up >/dev/null 2>&1 ) \
  || { fail "start.sh up"; exit 1; }
rig_wait_healthy "integration api rig" 60 || exit 1
( cd "$SCRIPT_DIR" && COMPOSE_FILES="-f docker-compose.yml" ./start.sh seed-demo >/dev/null 2>&1 )

say "Minting two tokens: one broad, one shopping-only"
node -e '
const {createHash,randomBytes}=require("crypto");
const mk=()=>{const t="kbi_"+randomBytes(32).toString("base64url");
  return {t,h:createHash("sha256").update(t).digest("hex")};};
console.log(JSON.stringify({full:mk(),shop:mk()}));' > "$TMP/tok.json"
FULL=$(node -e "console.log(require('$TMP/tok.json').full.t)")
SHOP=$(node -e "console.log(require('$TMP/tok.json').shop.t)")
FULL_H=$(node -e "console.log(require('$TMP/tok.json').full.h)")
SHOP_H=$(node -e "console.log(require('$TMP/tok.json').shop.h)")

psql_rig <<SQL >/dev/null
INSERT INTO integration_tokens (family_id, name, token_hash, scopes)
SELECT id, 'e2e-full', '$FULL_H',
       ARRAY['family:read','events:read','shopping:write','tasks:write','notes:write']
FROM families LIMIT 1;
INSERT INTO integration_tokens (family_id, name, token_hash, scopes)
SELECT id, 'e2e-shopping-only', '$SHOP_H', ARRAY['shopping:write'] FROM families LIMIT 1;
SQL

# ---------------------------------------------------------------- the checks

say "Authentication"
chk "no token -> 401"      "$(curl -so /dev/null -w '%{http_code}' "$API/info")" 401
chk "unknown token -> 401" "$(curl -so /dev/null -w '%{http_code}' -H 'Authorization: Bearer kbi_nope' "$API/info")" 401
chk "valid token -> 200"   "$(curl -so /dev/null -w '%{http_code}' -H "Authorization: Bearer $FULL" "$API/info")" 200

say "/info and /family/summary"
curl -s -H "Authorization: Bearer $FULL" "$API/info" > "$TMP/info.json"
curl -s -H "Authorization: Bearer $FULL" "$API/family/summary" > "$TMP/sum.json"
node -e "
const i=require('$TMP/info.json'), s=require('$TMP/sum.json').summary;
const out=[];
const ok=(c,m)=>out.push((c?'OK|':'NO|')+m);
ok(typeof i.version==='string','version reported: '+i.version);
ok(Array.isArray(i.scopes)&&i.scopes.length===5,'scopes echoed for the config flow');
ok(typeof i.cursor==='number','cursor for a first connect: '+i.cursor);
const keys=['next_family_event','events_today','shopping_items','meal_today','tasks_due','school_tomorrow','birthdays_upcoming','display_mode','attention_required'];
ok(keys.every(k=>k in s),'all 9 sensor fields present');
ok(s.display_mode===null&&s.attention_required===false,'Heute-Motor fields present but null/false');
console.log(out.join('\n'));
" | while IFS='|' read -r st msg; do [ "$st" = "OK" ] && pass "$msg" || fail "$msg"; done

say "The correlation id reaches the wire"
CID=$(curl -si -H "Authorization: Bearer $FULL" "$API/info" | grep -i '^x-correlation-id:' | tr -d '\r' | awk '{print $2}')
[ -n "$CID" ] && pass "x-correlation-id present ($CID)" || fail "x-correlation-id missing"

say "Idempotency"
chk "no Idempotency-Key -> 400" "$(post add_shopping_item '' '{"name":"Milch"}' "$TMP/o.json" "$FULL")" 400
K="e2e-$(date +%s%N)"
chk "first call -> 201" "$(post add_shopping_item "$K" '{"name":"Milch"}' "$TMP/a.json" "$FULL")" 201
chk "replay -> 201"     "$(post add_shopping_item "$K" '{"name":"Milch"}' "$TMP/b.json" "$FULL")" 201
A=$(node -e "console.log(require('$TMP/a.json').id)"); B2=$(node -e "console.log(require('$TMP/b.json').id)")
[ "$A" = "$B2" ] && pass "replay returned the same row — no duplicate" || fail "replay created a second row"
chk "same key, different body -> 409" "$(post add_shopping_item "$K" '{"name":"Brot"}' "$TMP/c.json" "$FULL")" 409
K2="e2e-order-$(date +%s%N)"
chk "key order irrelevant: first  -> 201" "$(post create_task "$K2" '{"title":"M","due_at":"2026-08-09"}' "$TMP/d.json" "$FULL")" 201
chk "key order irrelevant: swapped -> 201 (not 409)" "$(post create_task "$K2" '{"due_at":"2026-08-09","title":"M"}' "$TMP/e.json" "$FULL")" 201

say "Scopes — RFC-001 §10: a write service cannot act outside its scopes"
chk "shopping-only CAN add a shopping item"  "$(post add_shopping_item "s1-$(date +%s%N)" '{"name":"Butter"}' "$TMP/f.json" "$SHOP")" 201
chk "shopping-only CANNOT create a task"     "$(post create_task "s2-$(date +%s%N)" '{"title":"no"}' "$TMP/g.json" "$SHOP")" 401
chk "shopping-only CANNOT create a note"     "$(post create_note "s3-$(date +%s%N)" '{"text":"no"}' "$TMP/h.json" "$SHOP")" 401
chk "shopping-only CANNOT read the family"   "$(curl -so /dev/null -w '%{http_code}' -H "Authorization: Bearer $SHOP" "$API/family/summary")" 401
chk "shopping-only CANNOT read events"       "$(curl -so /dev/null -w '%{http_code}' -H "Authorization: Bearer $SHOP" "$API/events")" 401

say "The outbox: a write that never touches a route still emits"
# This is the claim the architecture rests on. Twenty client components write
# straight to PostgREST; if events only came from route handlers, none of those
# actions would ever produce one.
KEY=$(grep '^SERVICE_ROLE_KEY=' "$SCRIPT_DIR/.env" | cut -d= -f2-)
FAM=$(psql_rig -c "SELECT id FROM families LIMIT 1")
CURSOR=$(curl -s -H "Authorization: Bearer $FULL" "$API/events" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).cursor))")
curl -s -o /dev/null -X POST "http://localhost:${RIG_KONG_HTTP_PORT}/rest/v1/shopping_items" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d "{\"family_id\":\"$FAM\",\"name\":\"outbox-proof\"}"
sleep 1
FOUND=$(curl -s -H "Authorization: Bearer $FULL" "$API/events?after=$CURSOR" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);
      console.log(r.events.some(e=>e.payload&&e.payload.name==='outbox-proof')?'yes':'no')})")
[ "$FOUND" = "yes" ] && pass "PostgREST write appeared in /events with no route involved" \
                     || fail "the outbox did not capture a direct database write"

say "Rate limiting"
HIT=0
for i in $(seq 1 40); do
  C=$(post add_shopping_item "rl-$i-$(date +%s%N)" "{\"name\":\"rl-$i\"}" "$TMP/r.json" "$FULL")
  [ "$C" = "429" ] && { HIT=$i; break; }
done
[ "$HIT" != "0" ] && pass "writes throttled after $HIT in the window" || fail "write limit never triggered"
RA=$(curl -si -X POST "$API/services/add_shopping_item" -H "Authorization: Bearer $FULL" \
      -H "Idempotency-Key: rl-x-$(date +%s%N)" -H 'Content-Type: application/json' -d '{"name":"x"}' \
      | grep -i '^retry-after:' | tr -d '\r' | awk '{print $2}')
[ -n "${RA:-}" ] && [ "$RA" -ge 1 ] 2>/dev/null && pass "Retry-After is ${RA}s and never zero" || fail "Retry-After missing or zero"
chk "reads keep working while writes are throttled" \
  "$(curl -so /dev/null -w '%{http_code}' -H "Authorization: Bearer $FULL" "$API/family/summary")" 200

# --------------------------------------------------------------------- result

if [ "${KEEP_UP:-0}" = "1" ]; then
  say "KEEP_UP=1 — stack left at $BASE_URL"
else
  say "Tearing down"; rig_teardown; rm -rf "$RIG_DATA"
fi

say "Result"
if [ ${#FAILURES[@]} -eq 0 ]; then
  grn "Integration API verified end to end over HTTP"
  exit 0
fi
red "${#FAILURES[@]} failure(s):"
for f in "${FAILURES[@]}"; do red "  - $f"; done
exit 1
