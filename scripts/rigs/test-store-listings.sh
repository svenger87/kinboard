#!/usr/bin/env bash
# test-store-listings.sh — the rehearsal of the generated store listings that
# needs no store system (RFC-024 §10, as far as it goes without one).
#
# For each store, the compose file that store would start, made runnable here
# (scripts/rigs/store-listings/runnable.mjs prints every change it makes),
# started as a throwaway project, and then:
#
#   - init and db-init exit 0; the database runs the stock PostgreSQL image
#     (docker.yml's POSTGRES_IMAGE_NAME) and db-init ran the role bootstrap;
#   - /api/health answers db: true;
#   - a family is created and joined from a second device;
#   - e2e/rls-matrix.spec.ts against it (§10 step 6, mandatory for any
#     listing on stock PostgreSQL): two families, each one's token against
#     the other's rows on every table, the bare anon role, filterless writes;
#   - the secrets survive a restart of the whole project.
#
# Which file is "the compose the store would run":
#   casaos     dist/casaos/Apps/<Name>/docker-compose.yml, as listed
#   umbrel     dist/umbrel/<app>/docker-compose.yml with umbrelOS's own
#              changes (container names, the shared network), and a decoy on
#              that network answering to `db` and `rest`, as another app's
#              services would
#   portainer  dist/portainer/compose.yml, with the template's variables
#   truenas    the app rendered by TrueNAS's own renderer (its apps_validation
#              image, through truenas/apps' ci.py --render-only, pinned in
#              scripts/stores/upstream.json): what TrueNAS's middleware hands
#              to docker compose. Not TrueNAS itself: no ix-volume datasets,
#              ACLs or app lifecycle, which only a TrueNAS VM can rehearse
#
# Usage:
#   KINBOARD_RIG=1 scripts/rigs/test-store-listings.sh [casaos umbrel portainer truenas]
#   RIG_IMAGE=<image:tag>   run the app's services on this image instead of the
#                           listing's pinned one (e.g. a local build of this
#                           branch, for a change the pinned image lacks); the
#                           database, PostgREST and go2rtc stay as listed
#   RIG_BUILD=1             build this checkout's webapp image and use it as
#                           RIG_IMAGE (what rigs.yml does: it tests this
#                           commit's app inside each store's compose)
#   RIG_MATRIX=0            skip the rls-matrix spec
#   KEEP_FAILED=1           leave a failed store's project up
#
# Isolation: one store at a time, each a compose project `kbstore-<store>`;
# loopback ports 3073 (web), 3074 (PostgREST), 8575/udp (WebRTC); data in a
# temporary folder. The CasaOS and Portainer listings keep compose.yml's
# fixed container (and Portainer's volume) names, kinboard-*, so like the
# other rigs it refuses to start while any of them exists. Everything it
# creates is removed at the end, data folders included.

set -uo pipefail

RIG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=rig-intent.sh
. "$RIG_DIR/rig-intent.sh"
rig_require_intent "$@"; set -- "${RIG_ARGS[@]}"
REPO_ROOT="$(cd "$RIG_DIR/../.." && pwd)"
STORES_DIR="$REPO_ROOT/scripts/stores"
STORES=("$@"); [ ${#STORES[@]} -gt 0 ] || STORES=(casaos umbrel portainer truenas)
WEB_PORT=3073
REST_PORT=3074
WEBRTC_PORT=8575
BASE_URL="http://localhost:${WEB_PORT}"
RIG_MATRIX="${RIG_MATRIX:-1}"
KEEP_FAILED="${KEEP_FAILED:-0}"
DECOY_NET="kbstore-umbrel-main"
SLOT=(); command -v kinboard-heavy-slot >/dev/null && SLOT=(kinboard-heavy-slot)

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
step() { printf '   %s\n' "$*"; }
FAILURES=()
SUMMARY=()
fail() { red "   FAIL: $*"; FAILURES+=("$*"); }
pass() { grn "   ok:   $*"; }

meta() { node --input-type=module -e "import {loadSources} from '$STORES_DIR/lib/sources.mjs'; const s=loadSources(); console.log($1)"; }
SLUG="$(meta s.meta.slug)" || { red "cannot read the metadata"; exit 1; }
NAME="$(meta s.meta.name)"
PG_IMAGE_NAME="$(meta s.images.postgres)"
APP_IMAGE_NAME="$(meta s.images.app)"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/kbstore.XXXXXX")"
PROJECT=""
COMPOSE_FILE_=""
GIT_BEFORE="$(git -C "$REPO_ROOT" status --porcelain=v1 2>/dev/null)"

dc() { ( cd "$WORK" && env -i PATH="$PATH" HOME="$HOME" ${DOCKER_HOST:+DOCKER_HOST="$DOCKER_HOST"} "${DC_ENV[@]}" \
  timeout --kill-after=30 600 docker compose -p "$PROJECT" -f "$COMPOSE_FILE_" "$@" ); }
DC_ENV=()

diag() {
  docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format '     {{.Names}}\t{{.Status}}\t{{.Image}}'
  local c
  for c in $(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Names}}'); do
    echo "     --- $c"; docker logs --tail 40 "$c" 2>&1 | sed 's/^/       /'
  done
}
# The root-owned files the containers wrote, removed from inside a container.
wipe() { [ -d "$1" ] && docker run --rm -v "$1:/w" alpine:3 sh -c 'rm -rf /w/* /w/.[!.]* 2>/dev/null; true' >/dev/null 2>&1; rm -rf "$1" 2>/dev/null; true; }
down() {
  [ -n "$PROJECT" ] && [ -n "$COMPOSE_FILE_" ] && dc down -v --remove-orphans >/dev/null 2>&1
  docker rm -f kbstore-decoy >/dev/null 2>&1
  docker network rm "$DECOY_NET" >/dev/null 2>&1
  # The Portainer stack's fixed volume names.
  [ "${1:-}" = portainer ] && docker volume rm "$SLUG-db" "$SLUG-storage" "$SLUG-config" >/dev/null 2>&1
  wipe "$WORK/data"
  true
}
on_exit() {
  local rc=$?
  trap - EXIT INT TERM
  if [ "$KEEP_FAILED" = 1 ] && [ ${#FAILURES[@]} -gt 0 ]; then red "KEEP_FAILED=1: project $PROJECT left up; files in $WORK"
  else down "${CURRENT:-}"; rm -rf "$WORK"; [ -n "${BUILT:-}" ] && docker image rm "$BUILT" >/dev/null 2>&1; fi
  if [ "$(git -C "$REPO_ROOT" status --porcelain=v1 2>/dev/null)" != "$GIT_BEFORE" ]; then red "the checkout changed during the run"; [ "$rc" = 0 ] && rc=1; fi
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

say "Store listings, rehearsed without the store (RFC-024 §10)"
for tool in docker curl jq openssl node; do command -v "$tool" >/dev/null || { red "needs $tool"; exit 1; }; done
taken=()
for c in init db db-init rest webapp go2rtc; do docker container inspect "$SLUG-$c" >/dev/null 2>&1 && taken+=("container $SLUG-$c"); done
for v in db storage config; do docker volume inspect "$SLUG-$v" >/dev/null 2>&1 && taken+=("volume $SLUG-$v"); done
[ ${#taken[@]} -eq 0 ] || { red "REFUSING: this host has ${taken[*]}; the CasaOS and Portainer listings use those fixed names."; exit 1; }
for p in "$WEB_PORT" "$REST_PORT"; do ss -lnt | awk '{print $4}' | grep -qE "[:.]$p\$" && { red "port $p is in use"; exit 1; }; done
for p in "$WEBRTC_PORT" 8555; do ss -lnu | awk '{print $4}' | grep -qE "[:.]$p\$" && { red "udp $p is in use"; exit 1; }; done
node "$STORES_DIR/build-store-listings.mjs" --check >/dev/null || { red "dist/ is out of date: run scripts/stores/build-store-listings.mjs"; exit 1; }
BUILT=""
if [ "${RIG_BUILD:-0}" = 1 ] && [ -z "${RIG_IMAGE:-}" ]; then
  RIG_IMAGE="kbstore-rig:$(git -C "$REPO_ROOT" rev-parse --short=7 HEAD)"
  say "Building this checkout's webapp image ($RIG_IMAGE)"
  timeout 2400 "${SLOT[@]}" docker build -q -f "$REPO_ROOT/webapp/docker/Dockerfile" -t "$RIG_IMAGE" "$REPO_ROOT/webapp" >/dev/null \
    || { red "webapp build failed"; exit 1; }
  BUILT="$RIG_IMAGE"
fi
if [ -n "${RIG_IMAGE:-}" ]; then
  baked="$(docker run --rm --entrypoint sh "$RIG_IMAGE" -c 'grep -rlE "localhost:(8000|8130)" /app/.next/ 2>/dev/null | wc -l')"
  [ "$baked" = 0 ] || { red "$RIG_IMAGE has a localhost API address baked in; build it from a clean checkout"; exit 1; }
fi
[ -n "${RIG_IMAGE:-}" ] && step "the app's services run $RIG_IMAGE (RIG_IMAGE), not the listing's pinned image"

plain() { sed 's/\x1b\[[0-9;]*[A-Za-z]//g; s/\r/\n/g' "$1"; }
summary() { plain "$1" | grep -E '^\s+[0-9]+ (passed|failed|skipped|flaky|did not run)' | sed 's/^ *//' | tr '\n' ' '; }

# The container of a service in the running project.
cname() { docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1" --format '{{.Names}}' | head -n1; }

rehearse() {  # rehearse <store> <compose file the store runs> <data root to move> [env…]
  local store="$1" src="$2" root="$3"; shift 3
  CURRENT="$store"; PROJECT="kbstore-$store"; COMPOSE_FILE_="$WORK/$store.compose.yml"; DC_ENV=("$@")
  mkdir -p "$WORK/data"
  local opts
  opts="$(jq -cn --arg dataRoot "$root" --arg data "$WORK/data" --arg slug "$SLUG" --arg network "$DECOY_NET" \
    --argjson webPort "$WEB_PORT" --argjson restPort "$REST_PORT" --argjson webrtcPort "$WEBRTC_PORT" \
    '{dataRoot:$dataRoot,data:$data,slug:$slug,network:$network,webPort:$webPort,restPort:$restPort,webrtcPort:$webrtcPort}')"
  node "$RIG_DIR/store-listings/runnable.mjs" "$store" "$src" "$COMPOSE_FILE_" "$opts" || { fail "$store: could not make the file runnable"; return; }
  if [ -n "${RIG_IMAGE:-}" ]; then
    sed -i -E "s#image: ${APP_IMAGE_NAME}:[^ ]+#image: ${RIG_IMAGE}#" "$COMPOSE_FILE_"
  fi
  if [ "$store" = umbrel ]; then
    docker network create "$DECOY_NET" >/dev/null || { fail "umbrel: shared network"; return; }
    # Another app's database and API on the shared network, under the bare names.
    docker run -d --name kbstore-decoy --network "$DECOY_NET" --network-alias db --network-alias rest \
      -e POSTGRES_PASSWORD="$(openssl rand -hex 12)" "$(grep -m1 -oE "image: ${PG_IMAGE_NAME}:[^ ]+" "$COMPOSE_FILE_" | cut -d' ' -f2)" >/dev/null \
      || { fail "umbrel: decoy"; return; }
    step "decoy kbstore-decoy answers to db and rest on $DECOY_NET"
  fi
  dc config -q || { fail "$store: docker compose config rejects the runnable file"; return; }
  step "docker compose up ($PROJECT)"
  if ! dc up -d >"$WORK/$store.up.log" 2>&1; then
    fail "$store: compose up failed"; tail -n 15 "$WORK/$store.up.log" | sed 's/^/     /'; diag; return
  fi
  local web; web="$(cname webapp)"
  local i state
  for ((i = 0; i < 300; i += 5)); do
    state="$(docker inspect -f '{{.State.Health.Status}}' "$web" 2>/dev/null)"
    [ "$state" = healthy ] && curl -sf -o /dev/null --max-time 3 "$BASE_URL/api/health" && break
    sleep 5
  done
  [ "$state" = healthy ] || { fail "$store: webapp not healthy within 300s (${state:-none})"; diag; return; }
  pass "$store: webapp healthy after ${i}s"
  local s
  for s in init db-init; do
    [ "$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$(cname "$s")")" = "exited 0" ] && pass "$store: $s exited 0" || fail "$store: $s did not exit 0"
  done
  local db; db="$(cname db)"
  case "$(docker inspect -f '{{.Config.Image}}' "$db")" in
    "$PG_IMAGE_NAME":*) pass "$store: the database runs $PG_IMAGE_NAME" ;;
    *) fail "$store: the database runs $(docker inspect -f '{{.Config.Image}}' "$db")" ;;
  esac
  # Captured first: `grep -q` closing the pipe early fails it under pipefail.
  local dbinit_log; dbinit_log="$(docker logs "$(cname db-init)" 2>&1)"
  grep -q "roles created" <<<"$dbinit_log" && pass "$store: db-init ran the role bootstrap" || fail "$store: no bootstrap in db-init's log"
  local preload; preload="$(docker exec "$db" psql -X -tA -U supabase_admin -d postgres -c "SELECT setting FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole, unnest(s.setconfig) setting WHERE r.rolname='authenticator'" 2>/dev/null)"
  grep -q 'session_preload_libraries=safeupdate' <<<"$preload" && pass "$store: safeupdate preloaded for authenticator" || fail "$store: safeupdate is not preloaded"
  # PostgREST's connection string names the host the listing gave the app's
  # services (Umbrel: the container, since `db` on the shared network may be
  # another app's).
  local want_host uri_host
  want_host="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$(cname init)" | sed -n 's/^POSTGRES_HOST=//p')"
  uri_host="$(docker exec "$web" sh -c 'cat /kinboard/secrets/db_uri' 2>/dev/null | sed -E 's#^[^@]*@([^:/]+).*#\1#')"
  [ "$uri_host" = "${want_host:-db}" ] && pass "$store: PostgREST reaches the database as $uri_host" \
    || fail "$store: PostgREST's db_uri names $uri_host, the listing ${want_host:-db}"
  local body; body="$(curl -s "$BASE_URL/api/health")"
  jq -e '.db == true' >/dev/null 2>&1 <<<"$body" && pass "$store: /api/health db: true" || fail "$store: /api/health: $(head -c 200 <<<"$body")"

  local created code fam joined
  created="$(curl -s -X POST "$BASE_URL/api/session/create" -H 'content-type: application/json' \
    -d "{\"familyName\":\"Store rig $store\",\"hardwareId\":\"rig-store-$store-1\",\"deviceName\":\"rig-store-$store-1\"}")"
  fam="$(jq -r '.family.id // empty' <<<"$created")"; code="$(jq -r '.family.join_code // empty' <<<"$created")"
  if [ -n "$fam" ] && [ -n "$code" ]; then
    joined="$(curl -s -X POST "$BASE_URL/api/session/join" -H 'content-type: application/json' \
      -d "{\"joinCode\":\"$code\",\"hardwareId\":\"rig-store-$store-2\",\"deviceName\":\"rig-store-$store-2\"}")"
    [ "$(jq -r '.family.id // empty' <<<"$joined")" = "$fam" ] && pass "$store: a family created and joined from a second device" \
      || fail "$store: join failed: $(head -c 200 <<<"$joined")"
  else
    fail "$store: could not create a family: $(head -c 200 <<<"$created")"
  fi

  local secret; secret="$(docker exec "$(cname webapp)" cat /kinboard/secrets/jwt_secret 2>/dev/null)"
  [ -n "$secret" ] || { fail "$store: cannot read the JWT secret from the config volume"; return; }
  if [ "$RIG_MATRIX" = 1 ]; then
    step "e2e/rls-matrix.spec.ts against it"
    local log="$WORK/$store.matrix.log"
    ( cd "$REPO_ROOT/webapp" && RLS_MATRIX_BASE_URL="$BASE_URL" RLS_MATRIX_POSTGREST_URL="http://127.0.0.1:$REST_PORT" \
        RLS_MATRIX_JWT_SECRET="$secret" KINBOARD_DB_CONTAINER="$db" PLAYWRIGHT_BASE_URL="$BASE_URL" PLAYWRIGHT_AUTOSTART_DEV=0 \
        timeout 900 "${SLOT[@]}" ./node_modules/.bin/playwright test e2e/rls-matrix.spec.ts --project=unit --workers=1 --reporter=line ) >"$log" 2>&1
    local rc=$?
    local out; out="$(plain "$log")"
    if [ "$rc" = 0 ] && grep -qE '^\s+[0-9]+ passed' <<<"$out" && ! grep -qE '^\s+[0-9]+ skipped' <<<"$out"; then
      pass "$store: rls-matrix $(summary "$log")"
    else
      fail "$store: rls-matrix $(summary "$log")"; plain "$log" | grep -E '[0-9]+\) \[|Error:' | head -12 | sed 's/^/     /'
    fi
  fi

  # The secrets are kept across a restart of everything.
  local before after
  before="$(docker exec "$(cname webapp)" sh -c 'cat /kinboard/secrets/* | sha256sum')"
  dc stop >/dev/null 2>&1 && dc up -d >"$WORK/$store.up2.log" 2>&1
  for ((i = 0; i < 180; i += 5)); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$(cname webapp)" 2>/dev/null)" = healthy ] && break; sleep 5
  done
  after="$(docker exec "$(cname webapp)" sh -c 'cat /kinboard/secrets/* | sha256sum' 2>/dev/null)"
  joined="$(curl -s -X POST "$BASE_URL/api/session/join" -H 'content-type: application/json' \
    -d "{\"joinCode\":\"$code\",\"hardwareId\":\"rig-store-$store-3\",\"deviceName\":\"rig-store-$store-3\"}")"
  if [ -n "$before" ] && [ "$before" = "$after" ] && [ "$(jq -r '.family.id // empty' <<<"$joined")" = "$fam" ]; then
    pass "$store: after a restart the secrets are unchanged and the family still joins"
  else
    fail "$store: after a restart (secrets same: $([ "$before" = "$after" ] && echo yes || echo no); join: $(head -c 120 <<<"$joined"))"
  fi
  SUMMARY+=("$store")
}

for store in "${STORES[@]}"; do
  say "$store"
  n_before=${#FAILURES[@]}
  case "$store" in
    casaos) rehearse casaos "$REPO_ROOT/dist/casaos/Apps/$NAME/docker-compose.yml" "/DATA/AppData/$SLUG" ;;
    umbrel) rehearse umbrel "$REPO_ROOT/dist/umbrel/$SLUG/docker-compose.yml" '${APP_DATA_DIR}/data' ;;
    portainer)
      tags="$(node -e 'const t=require(process.argv[1]).templates[0]; console.log(t.env.filter(e=>e.preset).map(e=>e.name).join(" "))' "$REPO_ROOT/dist/portainer/templates.json")"
      # The template's channel tags exist from the first release with this
      # stack; until then the household (and this rig) set the release's tags.
      app_tag="$(meta s.meta.release.app_tag)"; pg_tag="$(meta s.meta.release.postgres_tag)"
      set -- $tags
      rehearse portainer "$REPO_ROOT/dist/portainer/compose.yml" "" "$1=$app_tag" "$2=$pg_tag" ;;
    truenas)
      step "rendering with TrueNAS's renderer (validate-upstream.sh truenas)"
      if TRUENAS_RENDER_OUT="$WORK/truenas.rendered.yml" "$STORES_DIR/validate-upstream.sh" truenas >"$WORK/truenas.validate.log" 2>&1 \
        && [ -s "$WORK/truenas.rendered.yml" ]; then
        rehearse truenas "$WORK/truenas.rendered.yml" "/opt/tests/mnt/$SLUG"
      else
        fail "truenas: rendering failed"; tail -20 "$WORK/truenas.validate.log" | sed 's/^/     /'
      fi ;;
    *) fail "unknown store $store"; continue ;;
  esac
  if [ "$KEEP_FAILED" = 1 ] && [ ${#FAILURES[@]} -gt "$n_before" ]; then break; fi
  down "$store"; PROJECT=""; COMPOSE_FILE_=""
done

echo
if [ ${#FAILURES[@]} -gt 0 ]; then
  red "${#FAILURES[@]} failure(s):"; for f in "${FAILURES[@]}"; do red "  - $f"; done; exit 1
fi
grn "every rehearsed store passed: ${SUMMARY[*]}"
