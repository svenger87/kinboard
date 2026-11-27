#!/usr/bin/env bash
# test-aio.sh: the all-in-one image's gates and rehearsals (RFC-024 §4.2-4.4,
# §4.7, §6.5, phase 5).
#
#   fresh       a fresh start: secrets 0600 in 0700 owned by PUID, every
#               long-running process but s6 as PUID, PostgreSQL and PostgREST
#               on loopback only, /api/health db:true, a family created and
#               joined, a scheduled job run by the internal scheduler, the
#               first healthy minute recorded; `docker stop` well under 60 s
#               with PostgreSQL's clean shutdown, the next start without WAL
#               recovery, the family and its join code still there
#   gates       RFC-024 §6.5 on the all-in-one image: the security dump
#               compared along supabase/postgres 15 -> kinboard-postgres on
#               15 -> on 17 -> the all-in-one image (only reviewed lines may
#               differ, and none between the last two); e2e/rls-matrix.spec.ts
#               against it; filterless UPDATE/DELETE straight to its PostgREST
#               refused by safeupdate. Each proven red: a protection removed
#               must fail the comparison, the matrix, and the filterless check
#   puid        PUID=99 PGID=100 on a bind-mounted /data: every file 99:100,
#               the processes 99, healthy, a family created
#   transfer    `kinboard export` from a compose.yml stack (supabase/postgres
#               15) -> `kinboard import` into a fresh all-in-one -> every
#               table's rows and checksum, every file and the secrets equal;
#               then the other way, into a fresh compose stack. Red: a second
#               import into a non-empty install, an archive from another
#               version, a tampered table: refused or rolled back
#   migrate     a pending migration on existing data: a verified dump first;
#               with no writable backup folder, no migration and no start;
#               a version whose migration fails stops, names the version to go
#               back to, and the previous version then shows the rollback in
#               Settings' record
#   upgrade     the PostgreSQL major upgrade rehearsed on a copy of the fresh
#               phase's data, with the same image built on 18 over 17 (Alpine
#               3.24 packages both): a verified dump, pg_upgrade into db.new,
#               the switch, the family kept. Forced failures, each leaving
#               /data/db on 17 for the previous tag to start on: no writable
#               backup folder (db byte for byte the same), pg_upgrade --check
#               refusing the database, a new cluster that can't load
#               safeupdate, a switch cut off half-way. Then going back before
#               the first healthy minute puts 17 back; after it, refused
#   symlinks    root never writes through a link the data folder's user planted:
#               links (owned by PUID) at every name a root step writes under
#               /data, all pointing at a root-owned canary, then a start with a
#               pending migration, an interrupted upgrade switch and an import
#               into a files folder with a linked subfolder. The canary and a
#               root-owned folder must be untouched
#   measure     image sizes, idle memory of the container and per process
#
# Usage:
#   KINBOARD_RIG=1 scripts/rigs/test-aio.sh
#   RIG_IMAGE=<image:tag>   the webapp image (default: built from this checkout)
#   AIO_IMAGE=<image:tag>   the all-in-one image (default: built FROM RIG_IMAGE)
#   RIG_PHASES="fresh gates puid transfer migrate upgrade measure"   a subset
#   KEEP_FAILED=1           leave everything up after a failure
#
# Isolation: containers, volumes and networks named kbaio-* (compose projects
# kbaio-cmp and kbaio-cmp2, their container and volume names overridden);
# loopback ports 3071-3077. Refuses to start while any kbaio-* exists. Cleans
# up everything it made, images it built included.

set -uo pipefail

RIG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=rig-intent.sh
. "$RIG_DIR/rig-intent.sh"
rig_require_intent "$@"; set -- "${RIG_ARGS[@]}"
REPO_ROOT="$(cd "$RIG_DIR/../.." && pwd)"
DOCKER_DIR="$REPO_ROOT/webapp/docker"
IMAGE_DIR="$REPO_ROOT/webapp/image"
SPG="$RIG_DIR/stock-postgres"

RIG_PHASES="${RIG_PHASES:-fresh gates puid transfer migrate upgrade symlinks measure}"
KEEP_FAILED="${KEEP_FAILED:-0}"
P_MAIN=3071 P_SIDE=3072 P_CMP=3073 P_CMP2=3074 P_REST=3075 P_PUID=3076
NET=kbaio-net
SUPABASE_IMAGE="$(sed -n 's/^    image: \(supabase\/postgres:[^ ]*\)$/\1/p' "$REPO_ROOT/compose.yml")"
POSTGREST_IMAGE="$(sed -n 's/^    image: \(postgrest\/postgrest:[^ ]*\)$/\1/p' "$REPO_ROOT/compose.yml")"

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
step() { printf '   %s\n' "$*"; }
FAILURES=()
CHECKS=0
fail() { red "   FAIL: $*"; FAILURES+=("$*"); CHECKS=$((CHECKS + 1)); }
pass() { grn "   ok:   $*"; CHECKS=$((CHECKS + 1)); }
check() { local what="$1"; shift; if "$@"; then pass "$what"; else fail "$what"; fi; }
want() { case " $RIG_PHASES " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
SLOT=(); command -v kinboard-heavy-slot >/dev/null && SLOT=(kinboard-heavy-slot)

WORK=""
BUILT=()
GIT_BEFORE=""

cleanup_all() {
  docker ps -a --format '{{.Names}}' | grep -E '^kbaio-' | xargs -r docker rm -f >/dev/null 2>&1 || true
  for p in kbaio-cmp kbaio-cmp2; do docker network rm "${p}_kinboard" >/dev/null 2>&1 || true; done
  docker network rm "$NET" >/dev/null 2>&1 || true
  docker volume ls --format '{{.Name}}' | grep -E '^kbaio-' | xargs -r docker volume rm >/dev/null 2>&1 || true
}
on_exit() {
  local rc=$?
  trap - EXIT INT TERM
  if [ "$KEEP_FAILED" = 1 ] && [ ${#FAILURES[@]} -gt 0 ]; then
    red "KEEP_FAILED=1: kbaio-* left up; work folder $WORK"
    WORK=""
  else
    cleanup_all
    local i; for i in "${BUILT[@]}"; do docker image rm "$i" >/dev/null 2>&1 || true; done
  fi
  # Bind-mounted data belongs to other uids by now: removed from a container.
  if [ -n "$WORK" ]; then
    docker run --rm -v "$WORK:/w" alpine:3 sh -c 'rm -rf /w/* /w/.[!.]*' >/dev/null 2>&1 || true
    rm -rf "$WORK"
  fi
  if [ -n "$GIT_BEFORE" ] && [ "$(git -C "$REPO_ROOT" status --porcelain=v1 2>/dev/null)" != "$GIT_BEFORE" ]; then
    red "   the checkout changed during the run"; [ "$rc" = 0 ] && rc=1
  fi
  echo
  if [ ${#FAILURES[@]} -eq 0 ] && [ "$rc" = 0 ]; then grn "test-aio: $CHECKS checks, all passed"; else red "test-aio: $CHECKS checks, ${#FAILURES[@]} failed"; [ "$rc" = 0 ] && rc=1; fi
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ---------------------------------------------------------------- preflight

say "Kinboard all-in-one image (RFC-024 phase 5)"
for tool in docker curl jq openssl sha256sum bc; do command -v "$tool" >/dev/null || { red "needs $tool"; exit 1; }; done
# `grep -q < <(…)`, never `… | grep -q`: under pipefail, -q's early exit kills
# the writer with SIGPIPE and a match reads as "not found" (it did, in CI).
if grep -qE '^kbaio-' < <(docker ps -a --format '{{.Names}}') || grep -qE '^kbaio-' < <(docker volume ls --format '{{.Name}}'); then
  red "kbaio-* containers or volumes exist: another run of this rig?"; exit 1
fi
for p in $P_MAIN $P_SIDE $P_CMP $P_CMP2 $P_REST $P_PUID; do
  grep -qE "[:.]${p}\$" < <(ss -lnt 2>/dev/null | awk '{print $4}') && { red "port $p is in use"; exit 1; }
done
GIT_BEFORE="$(git -C "$REPO_ROOT" status --porcelain=v1 2>/dev/null)" || GIT_BEFORE=""
WORK="$(mktemp -d "${TMPDIR:-/tmp}/kinboard-aio-rig.XXXXXX")"
rev="$(git -C "$REPO_ROOT" rev-parse --short=7 HEAD)"

if [ -z "${RIG_IMAGE:-}" ]; then
  RIG_IMAGE="kbaio-rig-webapp:$rev"
  say "Building the webapp image ($RIG_IMAGE)"
  "${SLOT[@]}" docker build -q --build-arg BUILD_REVISION="$rev" -f "$IMAGE_DIR/Dockerfile" -t "$RIG_IMAGE" "$REPO_ROOT/webapp" >/dev/null \
    || { red "webapp build failed"; exit 1; }
  BUILT+=("$RIG_IMAGE")
fi
baked="$(docker run --rm --entrypoint sh "$RIG_IMAGE" -c 'grep -rlE "localhost:(8000|8130)" /app/.next/ 2>/dev/null | wc -l')"
[ "$baked" = 0 ] || { red "$RIG_IMAGE has a localhost API address baked in; build it from a clean checkout"; exit 1; }
aio_build() {  # aio_build <tag> [build args...]
  local tag="$1"; shift
  "${SLOT[@]}" docker build -q --build-arg APP_IMAGE="$RIG_IMAGE" --build-arg BUILD_REVISION="$rev" "$@" \
    -f "$IMAGE_DIR/aio/Dockerfile" -t "$tag" "$IMAGE_DIR/aio" >/dev/null
}
if [ -z "${AIO_IMAGE:-}" ]; then
  AIO_IMAGE="kbaio-rig-aio:$rev"
  say "Building the all-in-one image ($AIO_IMAGE, FROM $RIG_IMAGE)"
  aio_build "$AIO_IMAGE" || { red "all-in-one build failed"; exit 1; }
  BUILT+=("$AIO_IMAGE")
fi
step "webapp $RIG_IMAGE; all-in-one $AIO_IMAGE"

# ------------------------------------------------------------------ helpers

# aio_run <name> <port> <volume or folder> [docker run args...] [-- image]
aio_run() {
  local name="$1" port="$2" data="$3"; shift 3
  local image="$AIO_IMAGE"
  if [ "${1:-}" = --image ]; then image="$2"; shift 2; fi
  docker run -d --name "$name" --stop-timeout 60 -p "127.0.0.1:$port:3000" -v "$data:/data" \
    -e SESSION_RATE_LIMIT_PER_MINUTE=1000 "$@" "$image" >/dev/null
}
# wait_healthy <name> [seconds]: 0 healthy; 1 exited or timed out (says which)
wait_healthy() {
  local name="$1" max="${2:-420}" i st
  for ((i = 0; i < max; i += 3)); do
    st="$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$name" 2>/dev/null)"
    case "$st" in
      "running healthy") return 0 ;;
      exited*) step "$name exited ($(docker inspect -f '{{.State.ExitCode}}' "$name"))"; return 1 ;;
    esac
    sleep 3
  done
  step "$name not healthy within ${max}s ($st)"; return 1
}
# wait_exit <name> [seconds]: 0 once the container has stopped by itself
wait_exit() {
  local name="$1" max="${2:-300}" i
  for ((i = 0; i < max; i += 2)); do
    [ "$(docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null)" = exited ] && return 0
    sleep 2
  done
  return 1
}
logs() { docker logs "$1" 2>&1; }
# proc_user <ps -o user,args output> <command start>: the user of that program
# itself, by the start of its command line (not its s6-supervise).
proc_user() { awk -v p="$2" 'NR > 1 { u = $1; $1 = ""; sub(/^ /, ""); if (index($0, p) == 1) { print u; exit } }' <<<"$1"; }
wait_http() {  # wait_http <base url>: /api/health 200 with db:true within 120 s
  local i; for i in $(seq 1 60); do curl -sf --max-time 3 "$1/api/health" | jq -e '.db == true' >/dev/null 2>&1 && return 0; sleep 2; done; return 1
}
apsql() { local c="$1"; shift; docker exec -i "$c" psql -X -q -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -tA "$@"; }
family_and_join() {  # family_and_join <base url> <label> -> echoes "<family id> <code>"
  local created fam code joined
  created="$(curl -s -X POST "$1/api/session/create" -H 'content-type: application/json' \
    -d "{\"familyName\":\"AIO rig $2\",\"hardwareId\":\"rig-aio-$2-1\",\"deviceName\":\"rig-aio-$2-1\"}")"
  fam="$(jq -r '.family.id // empty' <<<"$created")"; code="$(jq -r '.family.join_code // empty' <<<"$created")"
  [ -n "$fam" ] && [ -n "$code" ] || { echo "create failed: $(head -c 200 <<<"$created")" >&2; return 1; }
  joined="$(curl -s -X POST "$1/api/session/join" -H 'content-type: application/json' \
    -d "{\"joinCode\":\"$code\",\"hardwareId\":\"rig-aio-$2-2\",\"deviceName\":\"rig-aio-$2-2\"}")"
  [ "$(jq -r '.family.id // empty' <<<"$joined")" = "$fam" ] || { echo "join failed: $(head -c 200 <<<"$joined")" >&2; return 1; }
  echo "$fam $code"
}
joins() {  # joins <base url> <code> <label>: the code still lets a new device in
  [ "$(curl -s -X POST "$1/api/session/join" -H 'content-type: application/json' \
    -d "{\"joinCode\":\"$2\",\"hardwareId\":\"rig-aio-$3\",\"deviceName\":\"rig-aio-$3\"}" | jq -r '.family.id // empty')" != "" ]
}
copy_volume() { docker volume create "$2" >/dev/null; docker run --rm -v "$1:/from:ro" -v "$2:/to" alpine:3 sh -c 'cp -a /from/. /to/'; }
in_volume() { local v="$1"; shift; docker run --rm -v "$v:/data" alpine:3 sh -c "$*"; }
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt() {
  local input
  input="$(printf '{"alg":"HS256","typ":"JWT"}' | b64url).$(printf '%s' "$1" | b64url)"
  printf '%s.%s' "$input" "$(printf '%s' "$input" | openssl dgst -sha256 -hmac "$2" -binary | b64url)"
}
plain() { sed 's/\x1b\[[0-9;]*[A-Za-z]//g; s/\r/\n/g' "$1"; }
summary() { plain "$1" | grep -E '^\s+[0-9]+ (passed|failed|skipped|flaky|did not run)' | sed 's/^ *//' | tr '\n' ' '; }

MAIN=kbaio-main
MAIN_VOL=kbaio-main-data
MAIN_URL="http://127.0.0.1:$P_MAIN"
MAIN_UP=0

# -------------------------------------------------------------------- fresh

start_main() {
  # PostgREST on the host only for the gates' straight-to-PostgREST checks:
  # a sidecar in the container's network namespace forwards 3011 to its
  # loopback 3010. The image itself publishes nothing but 3000.
  aio_run "$MAIN" "$P_MAIN" "$MAIN_VOL" -p "127.0.0.1:$P_REST:3011"
}

if want fresh || want gates || want upgrade || want migrate || want symlinks || want measure; then
  say "fresh: a new all-in-one install"
  t0=$(date +%s)
  start_main
  if wait_healthy "$MAIN"; then
    MAIN_UP=1
    pass "fresh: healthy $(( $(date +%s) - t0 ))s after docker run, nothing set"
  else
    fail "fresh: never healthy"; logs "$MAIN" | tail -40 | sed 's/^/     /'
  fi
fi

if [ "$MAIN_UP" = 1 ] && want fresh; then
  body="$(curl -s "$MAIN_URL/api/health")"
  check "fresh: /api/health db:true ($body)" jq -e '.db == true' <<<"$body" >/dev/null
  modes="$(docker exec "$MAIN" sh -c 'stat -c "%a %u:%g %n" /data/config/secrets /data/config/secrets/* /data/db | sort -u')"
  bad="$(awk '$1 != "600" && $1 != "700" || $2 != "1000:1000"' <<<"$modes")"
  check "fresh: secrets 0600 in a 0700 folder and the cluster 0700, all 1000:1000 ($(wc -l <<<"$modes") paths)" test -z "$bad"
  [ -z "$bad" ] || printf '%s\n' "$bad" | sed 's/^/     /'
  procs="$(docker exec "$MAIN" ps -o user,args)"
  for p in /usr/libexec/postgresql17/postgres /usr/local/bin/postgrest next-server; do
    user="$(proc_user "$procs" "$p")"
    check "fresh: $p runs as uid 1000, not root ($user)" test "$user" = node
  done
  rootish="$(docker exec "$MAIN" ps -o user,comm | awk 'NR > 1 && $1 == "root" && $2 !~ /^(s6-|awk$|sh$|sleep$|ps$|curl$|healthwatch)/')"
  check "fresh: nothing else as root but s6, the log forwarders and healthwatch" test -z "$rootish"
  [ -z "$rootish" ] || printf '%s\n' "$rootish" | sed 's/^/     /'
  # Listening sockets, IPv4 and IPv6: "<address>:<port>" in /proc's hex.
  listen="$(docker exec "$MAIN" sh -c 'cat /proc/net/tcp /proc/net/tcp6' | awk '$4 == "0A" {print $2}')"
  only_loopback() {  # only_loopback <hex port>: listening, and only on 127.0.0.1 (0100007F)
    local mine; mine="$(grep -E ":$1\$" <<<"$listen")"
    [ "$mine" = "0100007F:$1" ]
  }
  check "fresh: PostgreSQL listens on 127.0.0.1:5432 only" only_loopback 1538
  check "fresh: PostgREST listens on 127.0.0.1:3010 only" only_loopback 0BC2
  if out="$(family_and_join "$MAIN_URL" fresh)"; then
    read -r MAIN_FAM MAIN_CODE <<<"$out"; pass "fresh: a family created and joined from a second device"
  else
    fail "fresh: family: $out"
  fi
  for i in $(seq 1 30); do [ "$(logs "$MAIN" | grep -c 'Job "process-notifications".*Finished in .*failed: false')" -gt 0 ] && break; sleep 2; done
  check "fresh: the internal scheduler ran a job (process-notifications, failed: false)" bash -c "docker logs $MAIN 2>&1 | grep -q 'Job \"process-notifications\".*Finished in .*failed: false'"
  check "fresh: logs prefixed per process on stdout ([postgres], [rest], [webapp])" bash -c "l=\$(docker logs $MAIN 2>&1); grep -q '^\[postgres\] ' <<<\"\$l\" && grep -q '^\[rest\] ' <<<\"\$l\" && grep -q '^\[webapp\] ' <<<\"\$l\""
  for i in $(seq 1 40); do docker exec "$MAIN" test -f /data/config/updater/last-good && break; sleep 3; done
  check "fresh: the first healthy minute recorded ($(docker exec "$MAIN" sh -c 'tr "\n" " " </data/config/updater/last-good' 2>/dev/null))" \
    docker exec "$MAIN" grep -q '^version=' /data/config/updater/last-good

  t0=$(date +%s.%N)
  docker stop "$MAIN" >/dev/null
  took="$(echo "$(date +%s.%N) - $t0" | bc)"
  check "fresh: docker stop took ${took}s (under 60 s, PostgreSQL's window 30 s)" bash -c "(( \$(echo '$took < 60' | bc) ))"
  check "fresh: PostgreSQL shut down cleanly (fast shutdown, checkpoint)" bash -c "docker logs $MAIN 2>&1 | grep -q 'received fast shutdown request' && docker logs $MAIN 2>&1 | grep -q 'database system is shut down'"
  check "fresh: exit code 0" test "$(docker inspect -f '{{.State.ExitCode}}' "$MAIN")" = 0
  n_before="$(logs "$MAIN" | grep -c 'database system was shut down at')"
  docker start "$MAIN" >/dev/null
  if wait_healthy "$MAIN"; then
    check "fresh: restarted without WAL recovery" bash -c "[ \$(docker logs $MAIN 2>&1 | grep -c 'database system was shut down at') -gt $n_before ] && ! docker logs $MAIN 2>&1 | grep -qE 'database system was (interrupted|not properly shut down)|redo starts'"
    check "fresh: the family survived the restart" test "$(apsql "$MAIN" -c "SELECT count(*) FROM families WHERE id = '${MAIN_FAM:-00000000-0000-0000-0000-000000000000}'")" = 1
    check "fresh: its join code still lets a device in" joins "$MAIN_URL" "${MAIN_CODE:-none}" fresh-3
    check "fresh: the secrets were kept (no 'generated' on the second start)" bash -c "[ \$(docker logs $MAIN 2>&1 | grep -c 'secret jwt_secret: generated') = 1 ]"
  else
    fail "fresh: not healthy after the restart"; MAIN_UP=0
  fi
fi

# -------------------------------------------------------------------- gates

DB_IMAGES_BUILT=0
build_db_images() {
  [ "$DB_IMAGES_BUILT" = 1 ] && return 0
  local base17; base17="$(sed -n 's/^ARG BASE=//p' "$IMAGE_DIR/postgres/Dockerfile")"
  "${SLOT[@]}" docker build -q -t "kbaio-rig-pg:17-$rev" "$IMAGE_DIR/postgres" >/dev/null || return 1
  "${SLOT[@]}" docker build -q --build-arg BASE=postgres:15-alpine -t "kbaio-rig-pg:15-$rev" "$IMAGE_DIR/postgres" >/dev/null || return 1
  BUILT+=("kbaio-rig-pg:17-$rev" "kbaio-rig-pg:15-$rev")
  DB_IMAGES_BUILT=1
  step "kinboard-postgres on $base17 and on postgres:15-alpine"
}
dump_container() { docker exec -i "$1" psql -X -q -U supabase_admin -d postgres -v ON_ERROR_STOP=1 <"$SPG/security-dump.sql" | LC_ALL=C sort; }
compare() {  # compare <label> <left> <right> <expected file>; 0 when only the reviewed lines differ
  "$SPG/compare-dumps.sh" "$2" "$3" "$4" >"$WORK/compare.out" 2>&1
}

if [ "$MAIN_UP" = 1 ] && want gates; then
  say "gates: the security dump, supabase/postgres 15 -> stock 15 -> stock 17 -> all-in-one"
  build_db_images || fail "gates: kinboard-postgres builds"
  PW="$(openssl rand -hex 16)"
  docker network create "$NET" >/dev/null
  declare -A IMG=([kbaio-supa15]="$SUPABASE_IMAGE" [kbaio-pg15]="kbaio-rig-pg:15-$rev" [kbaio-pg17]="kbaio-rig-pg:17-$rev")
  for db in kbaio-supa15 kbaio-pg15 kbaio-pg17; do docker run -d --name "$db" --network "$NET" -e POSTGRES_PASSWORD="$PW" "${IMG[$db]}" >/dev/null; done
  # Each image's own init scripts first (supabase/postgres creates its
  # extensions there): a database prepared before they finish compares wrong.
  for db in kbaio-supa15 kbaio-pg15 kbaio-pg17; do
    # grep -c, not -q: under pipefail, -q's early exit kills `docker logs` with SIGPIPE and reads as "not found".
    for i in $(seq 1 120); do [ "$(docker logs "$db" 2>&1 | grep -c "init process complete")" -gt 0 ] && break; sleep 2; done
    [ "$(docker logs "$db" 2>&1 | grep -c "init process complete")" -gt 0 ] || step "$db: no 'init process complete' within 240 s"
  done
  for db in kbaio-supa15 kbaio-pg15 kbaio-pg17; do
    if timeout 300 docker run --rm --network "$NET" -e POSTGRES_HOST="$db" -e POSTGRES_PASSWORD="$PW" "$RIG_IMAGE" kinboard-db-init >"$WORK/$db.init.log" 2>&1 \
       && timeout 600 docker run --rm --network "$NET" -e POSTGRES_HOST="$db" -e POSTGRES_USER=postgres -e PGPASSWORD="$PW" --entrypoint sh "$RIG_IMAGE" /app/migrate.sh >"$WORK/$db.mig.log" 2>&1; then
      dump_container "$db" >"$WORK/$db.dump"
    else
      fail "gates: preparing $db"; tail -5 "$WORK/$db.init.log" "$WORK/$db.mig.log" | sed 's/^/     /'
    fi
  done
  dump_container "$MAIN" >"$WORK/aio.dump"
  # The fresh phase's family and devices are rows, not security surface; the
  # dump has no row counts except the migrations recorded, the same on all.
  if compare a "$WORK/kbaio-supa15.dump" "$WORK/kbaio-pg15.dump" "$SPG/expected-supabase15-vs-stock15.txt"; then pass "gates: supabase/postgres 15 vs stock 15: $(tail -n1 "$WORK/compare.out" | sed 's/^compare-dumps: //')"
  else fail "gates: supabase/postgres 15 vs stock 15"; head -20 "$WORK/compare.out" | sed 's/^/     /'; fi
  if compare b "$WORK/kbaio-pg15.dump" "$WORK/kbaio-pg17.dump" "$SPG/expected-stock15-vs-stock17.txt"; then pass "gates: stock 15 vs stock 17: $(tail -n1 "$WORK/compare.out" | sed 's/^compare-dumps: //')"
  else fail "gates: stock 15 vs stock 17"; head -20 "$WORK/compare.out" | sed 's/^/     /'; fi
  if compare c "$WORK/kbaio-pg17.dump" "$WORK/aio.dump" "$SPG/expected-stock17-vs-aio17.txt"; then pass "gates: kinboard-postgres 17 vs the all-in-one image: $(tail -n1 "$WORK/compare.out" | sed 's/^compare-dumps: //')"
  else fail "gates: kinboard-postgres 17 vs the all-in-one image"; head -30 "$WORK/compare.out" | sed 's/^/     /'; fi
  for kind in policy rls relacl procacl role member setting defacl; do step "$kind lines in the all-in-one dump: $(grep -c "^$kind|" "$WORK/aio.dump")"; done

  say "gates, red: each protection removed in the all-in-one image fails the comparison"
  red_dump() { { echo "BEGIN;"; printf '%s\n' "$1"; cat "$SPG/security-dump.sql"; echo "ROLLBACK;"; } \
    | docker exec -i "$MAIN" psql -X -q -U supabase_admin -d postgres -v ON_ERROR_STOP=1 | LC_ALL=C sort >"$WORK/red.dump"; }
  compare_red() {  # compare_red <label> <sql> <needle>
    red_dump "$2"
    if compare r "$WORK/kbaio-pg17.dump" "$WORK/red.dump" "$SPG/expected-stock17-vs-aio17.txt"; then fail "gates red: $1 went unnoticed"
    elif grep -qE -- "$3" "$WORK/compare.out"; then pass "gates red: $1 fails the comparison ($(grep -m1 -E -- "$3" "$WORK/compare.out" | sed 's/^ *//' | cut -c1-90))"
    else fail "gates red: $1 failed, but not on $3"; head -6 "$WORK/compare.out" | sed 's/^/     /'; fi
  }
  compare_red "authenticated with BYPASSRLS" "ALTER ROLE authenticated BYPASSRLS;" 'role\|authenticated\|.*bypassrls=true'
  compare_red "SELECT on todos revoked from authenticated" "REVOKE SELECT ON public.todos FROM authenticated;" 'relacl\|r\|public\.todos\|authenticated\|SELECT'
  compare_red "safeupdate not preloaded" "ALTER ROLE authenticator RESET session_preload_libraries;" 'setting\|authenticator'
  compare_red "a policy on todos dropped" "DO \$\$ BEGIN EXECUTE (SELECT format('DROP POLICY %I ON public.todos', policyname) FROM pg_policies WHERE tablename = 'todos' LIMIT 1); END \$\$;" 'policy\|public\.todos\|'
  dump_container "$MAIN" >"$WORK/aio.after.dump"
  check "gates: every sabotage rolled back, the dump as before" cmp -s "$WORK/aio.dump" "$WORK/aio.after.dump"
  docker rm -f kbaio-supa15 kbaio-pg15 kbaio-pg17 >/dev/null 2>&1; docker network rm "$NET" >/dev/null 2>&1

  say "gates: PostgREST straight, no app guard: filterless writes refused by safeupdate"
  JWT_SECRET="$(docker exec "$MAIN" cat /data/config/secrets/jwt_secret)"
  # A forwarder in the container's network namespace: 3011 -> loopback 3010.
  docker run -d --name kbaio-restfwd --network "container:$MAIN" --entrypoint node "$RIG_IMAGE" -e '
    const net = require("node:net");
    net.createServer((c) => { const s = net.connect(3010, "127.0.0.1"); c.pipe(s); s.pipe(c);
      c.on("error", () => s.destroy()); s.on("error", () => c.destroy()); }).listen(3011, "0.0.0.0");' >/dev/null
  REST="http://127.0.0.1:$P_REST"
  now=$(date +%s)
  SERVICE="$(jwt "{\"role\":\"service_role\",\"iss\":\"kinboard\",\"iat\":$now,\"exp\":$((now + 7200))}" "$JWT_SECRET")"
  FAMTOK="$(jwt "{\"role\":\"authenticated\",\"family_id\":\"${MAIN_FAM:-}\",\"iss\":\"kinboard\",\"iat\":$now,\"exp\":$((now + 7200))}" "$JWT_SECRET")"
  for i in $(seq 1 20); do [ "$(curl -s -o /dev/null -w '%{http_code}' "$REST/todos?limit=1" -H "Authorization: Bearer $SERVICE")" = 200 ] && break; sleep 1; done
  apsql "$MAIN" >/dev/null <<SQL
INSERT INTO families (id, name, join_code) VALUES ('00000000-0000-4000-8000-0000000000fb', 'filterless B', 'FLTB02');
INSERT INTO todos (family_id, title) SELECT f, 'filterless ' || n
  FROM unnest(ARRAY['${MAIN_FAM:-00000000-0000-4000-8000-0000000000fb}', '00000000-0000-4000-8000-0000000000fb']::uuid[]) f, generate_series(1, 3) n;
SQL
  snapshot() { apsql "$MAIN" -c "SELECT count(*) || ':' || string_agg(xmin::text, ',' ORDER BY id) FROM public.todos"; }
  filterless() {  # filterless <token> <PATCH|DELETE>
    local body=(); [ "$2" = PATCH ] && body=(-H 'Content-Type: application/json' -d '{"title":"emptied"}')
    curl -s -X "$2" "$REST/todos" -H "Authorization: Bearer $1" -H 'Prefer: return=minimal' "${body[@]}"
  }
  start="$(snapshot)"; bad=()
  for who in SERVICE FAMTOK; do for m in PATCH DELETE; do
    verb=UPDATE; [ "$m" = DELETE ] && verb=DELETE
    out="$(filterless "${!who}" "$m")"
    jq -e --arg v "$verb requires a WHERE clause" '.message == $v' >/dev/null 2>&1 <<<"$out" || bad+=("$who $m: $out")
  done; done
  if [ ${#bad[@]} -eq 0 ] && [ "$(snapshot)" = "$start" ]; then
    pass "gates: 4 unfiltered writes refused by safeupdate (service role and family; UPDATE and DELETE), ${start%%:*} rows untouched"
  else fail "gates: filterless: ${bad[*]:-rows changed}"; fi
  apsql "$MAIN" -c "ALTER ROLE authenticator RESET session_preload_libraries;" >/dev/null
  docker exec "$MAIN" s6-svc -r /run/service/postgrest; sleep 4
  start="$(snapshot)"; out="$(filterless "$SERVICE" DELETE)"
  live="$(apsql "$MAIN" -c "SELECT count(*) FROM public.todos WHERE deleted_at IS NULL")"
  check "gates red: without the preload, the same unfiltered DELETE as the service role took every family's todos (${start%%:*} rows, $live left outside the recycle bin)" \
    bash -c "[ '$(snapshot)' != '$start' ] && [ '$live' = 0 ]"
  apsql "$MAIN" -c "ALTER ROLE authenticator SET session_preload_libraries = 'safeupdate';" >/dev/null
  docker exec "$MAIN" s6-svc -r /run/service/postgrest; sleep 4
  out="$(filterless "$SERVICE" DELETE)"
  check "gates: preload restored, refused again" jq -e '.message == "DELETE requires a WHERE clause"' <<<"$out" >/dev/null
  apsql "$MAIN" -c "DELETE FROM todos WHERE title LIKE 'filterless %'; SELECT delete_family('00000000-0000-4000-8000-0000000000fb');" >/dev/null
  # db-init's own check on every start refuses the same sabotage.
  apsql "$MAIN" -c "ALTER ROLE authenticated BYPASSRLS;" >/dev/null
  if docker exec "$MAIN" su-exec 1000:1000 sh /app/kinboard-db-init.sh >"$WORK/dbinit-red.log" 2>&1; then fail "gates red: db-init accepted authenticated with BYPASSRLS"
  else check "gates red: db-init refuses authenticated with BYPASSRLS" grep -q "authenticated bypasses row-level security" "$WORK/dbinit-red.log"; fi
  apsql "$MAIN" -c "ALTER ROLE authenticated NOBYPASSRLS;" >/dev/null

  say "gates: e2e/rls-matrix.spec.ts against the all-in-one image"
  matrix() {
    ( cd "$REPO_ROOT/webapp" && RLS_MATRIX_BASE_URL="$MAIN_URL" RLS_MATRIX_POSTGREST_URL="$REST" RLS_MATRIX_JWT_SECRET="$JWT_SECRET" \
        KINBOARD_DB_CONTAINER="$MAIN" PLAYWRIGHT_AUTOSTART_DEV=0 PLAYWRIGHT_BASE_URL="$MAIN_URL" \
        timeout 900 "${SLOT[@]}" ./node_modules/.bin/playwright test e2e/rls-matrix.spec.ts --project=unit --workers=1 --reporter=line >"$1" 2>&1 )
  }
  if matrix "$WORK/matrix.log"; then pass "rls-matrix on the all-in-one image: $(summary "$WORK/matrix.log")"
  else fail "rls-matrix: $(summary "$WORK/matrix.log")"; plain "$WORK/matrix.log" | grep -E '[0-9]+\) \[|Error:' | head -20 | sed 's/^/     /'; fi
  apsql "$MAIN" -c "ALTER ROLE authenticated BYPASSRLS;" >/dev/null
  if matrix "$WORK/matrix-red.log"; then fail "rls-matrix red: authenticated with BYPASSRLS went unnoticed"
  elif grep -qF "family A reads none of family B's rows" < <(plain "$WORK/matrix-red.log"); then pass "rls-matrix red: authenticated with BYPASSRLS fails \"family A reads none of family B's rows\" ($(summary "$WORK/matrix-red.log"))"
  else fail "rls-matrix red: failed, but not on the cross-family read"; fi
  apsql "$MAIN" -c "ALTER ROLE authenticated NOBYPASSRLS;" >/dev/null
  if matrix "$WORK/matrix-2.log"; then pass "rls-matrix green again: $(summary "$WORK/matrix-2.log")"; else fail "rls-matrix after the red run"; fi
  docker rm -f kbaio-restfwd >/dev/null 2>&1
fi

# --------------------------------------------------------------------- puid

if want puid; then
  say "puid: PUID=99 PGID=100 on a bind-mounted /data (Unraid's nobody:users)"
  mkdir -p "$WORK/puid-data"
  aio_run kbaio-puid "$P_PUID" "$WORK/puid-data" -e PUID=99 -e PGID=100
  if wait_healthy kbaio-puid; then
    pass "puid: healthy on a bind mount owned by $(stat -c %u:%g "$WORK/puid-data") before the start"
    others="$(docker exec kbaio-puid find /data \( ! -user 99 -o ! -group 100 \) | head -5)"
    check "puid: every file under /data is 99:100 ($(docker exec kbaio-puid find /data | wc -l) paths)" test -z "$others"
    [ -z "$others" ] || printf '%s\n' "$others" | sed 's/^/     /'
    check "puid: on the host too: $(stat -c %u:%g "$WORK/puid-data")" test "$(stat -c %u:%g "$WORK/puid-data")" = 99:100
    procs="$(docker exec kbaio-puid ps -o user,args)"
    # busybox ps prints the account's name: init-perms names uid 99 `kinboard`.
    check "puid: the account for uid 99 is kinboard ($(docker exec kbaio-puid awk -F: '$3 == 99' /etc/passwd))" \
      bash -c "docker exec kbaio-puid awk -F: '\$3 == 99 { print \$1 }' /etc/passwd | grep -qx kinboard"
    for p in /usr/libexec/postgresql17/postgres /usr/local/bin/postgrest next-server; do
      user="$(proc_user "$procs" "$p")"
      check "puid: $p runs as 99 ($user)" test "$user" = kinboard
    done
    check "puid: a family created and joined" family_and_join "http://127.0.0.1:$P_PUID" puid
  else
    fail "puid: not healthy"; logs kbaio-puid | tail -30 | sed 's/^/     /'
  fi
  docker rm -f kbaio-puid >/dev/null
  # A PUID of 0 is refused before anything is created.
  aio_run kbaio-puid0 "$P_PUID" kbaio-puid0-data -e PUID=0
  wait_exit kbaio-puid0 120
  check "puid red: PUID=0 is refused (PostgreSQL does not run as root), nothing created" \
    bash -c "docker logs kbaio-puid0 2>&1 | grep -q 'PUID and PGID must not be 0' && [ -z \"\$(docker run --rm -v kbaio-puid0-data:/d alpine:3 ls -A /d)\" ]"
  docker rm -f kbaio-puid0 >/dev/null
fi

# ----------------------------------------------------------------- transfer

# A compose.yml stack (supabase/postgres 15, the one-file install), under its
# own names: compose.yml fixes container and volume names, so an override
# renames them, and go2rtc (its fixed UDP port) is not started.
cmp_up() {  # cmp_up <project> <port>
  local p="$1" port="$2" d="$WORK/$1"
  mkdir -p "$d"
  cp "$REPO_ROOT/compose.yml" "$d/compose.yml"
  cat >"$d/compose.override.yml" <<YML
services:
  init: { container_name: $p-init }
  db: { container_name: $p-db }
  db-init: { container_name: $p-db-init }
  rest: { container_name: $p-rest }
  webapp:
    container_name: $p-webapp
    environment:
      SESSION_RATE_LIMIT_PER_MINUTE: "1000"
  go2rtc: { container_name: $p-go2rtc }
volumes:
  kinboard-db: { name: $p-db }
  kinboard-storage: { name: $p-storage }
  kinboard-config: { name: $p-config }
YML
  ( cd "$d" && env -i PATH="$PATH" HOME="$HOME" KINBOARD_IMAGE="${RIG_IMAGE%:*}" KINBOARD_TAG="${RIG_IMAGE##*:}" WEBAPP_PORT="$port" \
      timeout 600 docker compose -p "$p" up -d init db db-init rest webapp ) >"$WORK/$p.up.log" 2>&1
}
cmp_restart() { ( cd "$WORK/$1" && env -i PATH="$PATH" HOME="$HOME" KINBOARD_IMAGE="${RIG_IMAGE%:*}" KINBOARD_TAG="${RIG_IMAGE##*:}" WEBAPP_PORT="$2" \
  timeout 300 docker compose -p "$1" restart rest webapp ) >/dev/null 2>&1; }
# The manifest's tables as "schema.table rows checksum", sorted.
tables_of() { tar -xzOf "$1" manifest.json | jq -r '.tables[] | "\(.schema).\(.table) \(.rows) \(.checksum)"' | sort; }
files_of() { tar -xzOf "$1" manifest.json | jq -r '.files[] | "\(.path) \(.size) \(.sha256)"' | sort; }
secret_of() { tar -xzOf "$1" "secrets/$2" 2>/dev/null; }
# Tables a running install writes by itself between an import and the next
# export: the scheduler's heartbeats, and the server's time zone record the
# entrypoint rewrites at every start. Compared, and listed when they differ.
VOLATILE='^(public\.system_heartbeats|public\.instance_settings) '
same_data() {  # same_data <label> <archive a> <archive b>
  local a="$WORK/$1.a" b="$WORK/$1.b"
  tables_of "$2" | grep -vE "$VOLATILE" >"$a"; tables_of "$3" | grep -vE "$VOLATILE" >"$b"
  if diff "$a" "$b" >"$WORK/$1.diff"; then
    pass "$1: every table identical, rows and checksums ($(wc -l <"$a") tables, $(awk '{n += $2} END {print n}' "$a") rows)"
    step "written by the running app itself after the import, so not compared: $(tables_of "$2" | grep -E "$VOLATILE" | awk '{print $1 " " $2}' | tr '\n' ' ')-> $(tables_of "$3" | grep -E "$VOLATILE" | awk '{print $2}' | tr '\n' ' ')rows"
  else
    fail "$1: tables differ"; head -10 "$WORK/$1.diff" | sed 's/^/     /'
  fi
  check "$1: every uploaded file identical ($(files_of "$2" | wc -l) files, sizes and SHA-256)" bash -c "diff <(files_of_ '$2') <(files_of_ '$3') >/dev/null"
  for s in vapid_public_key vapid_private_key jwt_secret cron_secret presence_sensor_token; do
    check "$1: secret $s carried" bash -c "[ -n \"\$(tar -xzOf '$2' secrets/$s)\" ] && [ \"\$(tar -xzOf '$2' secrets/$s)\" = \"\$(tar -xzOf '$3' secrets/$s)\" ]"
  done
}
files_of_() { tar -xzOf "$1" manifest.json | jq -r '.files[] | "\(.path) \(.size) \(.sha256)"' | sort; }
export -f files_of_

if want transfer; then
  say "transfer: compose.yml (supabase/postgres 15) -> all-in-one -> compose.yml"
  if cmp_up kbaio-cmp "$P_CMP" && wait_healthy kbaio-cmp-webapp; then
    pass "transfer: the compose stack is up (supabase/postgres 15)"
    out="$(family_and_join "http://127.0.0.1:$P_CMP" cmp)" && read -r CMP_FAM CMP_CODE <<<"$out"
    # The demo family's data (seed-demo.sql: events, lists, meals, rewards…),
    # and uploaded files of every kind, as the webapp keeps them.
    docker exec -i kbaio-cmp-db psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 <"$DOCKER_DIR/seed-demo.sql" >/dev/null \
      && pass "transfer: the demo family seeded" || fail "transfer: seed-demo.sql"
    docker exec -u 0 kbaio-cmp-webapp sh -c 'mkdir -p /var/lib/storage/files/family-photos/a /var/lib/storage/files/recipe-images \
      && head -c 300000 /dev/urandom > /var/lib/storage/files/family-photos/a/photo.jpg \
      && printf "recipe" > "/var/lib/storage/files/recipe-images/pancakes with space.png" \
      && head -c 1 /dev/urandom > /var/lib/storage/files/recipe-images/tiny.bin \
      && chown -R nextjs:nodejs /var/lib/storage/files'
    docker exec kbaio-cmp-webapp kinboard export - >"$WORK/from-compose.tar.gz" 2>"$WORK/export1.log"
    check "transfer: kinboard export from compose ($(du -h "$WORK/from-compose.tar.gz" | cut -f1); $(tail -n2 "$WORK/export1.log" | head -n1 | sed 's/^\[kinboard\] //'))" \
      bash -c "tar -tzf '$WORK/from-compose.tar.gz' | grep -qx 'manifest.json'"
    check "transfer: the archive carries no database password" bash -c "! tar -tzf '$WORK/from-compose.tar.gz' | grep -q postgres_password"

    aio_run kbaio-imp "$P_SIDE" kbaio-imp-data
    if wait_healthy kbaio-imp; then
      docker exec -i kbaio-imp kinboard import - <"$WORK/from-compose.tar.gz" >"$WORK/import1.log" 2>&1
      check "transfer: kinboard import into a fresh all-in-one ($(grep -m1 'imported' "$WORK/import1.log" | sed 's/^\[kinboard\] //' | cut -c1-150))" grep -q 'every table.s count and checksum verified' "$WORK/import1.log"
      sleep 5; wait_http "http://127.0.0.1:$P_SIDE" || fail "transfer: not answering after the import's restart"
      docker exec kbaio-imp kinboard export - >"$WORK/aio-after.tar.gz" 2>/dev/null
      same_data "transfer compose->aio" "$WORK/from-compose.tar.gz" "$WORK/aio-after.tar.gz"
      check "transfer: the compose family's join code works on the all-in-one" joins "http://127.0.0.1:$P_SIDE" "${CMP_CODE:-none}" imp-join
      check "transfer: the demo family's join code (DEMO01) too" joins "http://127.0.0.1:$P_SIDE" DEMO01 imp-demo
      check "transfer: the photo is served by the all-in-one (owned by PUID)" test "$(docker exec kbaio-imp stat -c %u:%g /data/storage/files/family-photos/a/photo.jpg)" = 1000:1000

      say "transfer, red: what an import must refuse"
      docker exec -i kbaio-imp kinboard import - <"$WORK/from-compose.tar.gz" >"$WORK/import-again.log" 2>&1
      check "transfer red: a second import into the now non-empty install is refused" grep -q "already has .* family" "$WORK/import-again.log"
      # Another version: one migration's checksum changed in the manifest.
      mkdir -p "$WORK/tamper" && tar -xzf "$WORK/from-compose.tar.gz" -C "$WORK/tamper"
      jq '.migrations[-1].checksum = "0000"' "$WORK/tamper/manifest.json" >"$WORK/tamper/m" && mv "$WORK/tamper/m" "$WORK/tamper/manifest.json"
      tar -czf "$WORK/other-version.tar.gz" -C "$WORK/tamper" .
      aio_run kbaio-imp2 "$P_PUID" kbaio-imp2-data
      if wait_healthy kbaio-imp2; then
        docker exec -i kbaio-imp2 kinboard import - <"$WORK/other-version.tar.gz" >"$WORK/import-ver.log" 2>&1
        check "transfer red: an archive from another version is refused" grep -q "another version" "$WORK/import-ver.log"
        # A tampered table: one row of todos changed after the export.
        rm -rf "$WORK/tamper"; mkdir -p "$WORK/tamper" && tar -xzf "$WORK/from-compose.tar.gz" -C "$WORK/tamper"
        f="$(jq -r '.tables[] | select(.table == "todos") | .file' "$WORK/tamper/manifest.json")"
        sed -i '0,/\t/s/\t[^\t]*\t/\tTAMPERED\t/' "$WORK/tamper/$f"
        tar -czf "$WORK/tampered.tar.gz" -C "$WORK/tamper" .
        docker exec -i kbaio-imp2 kinboard import --no-restart - <"$WORK/tampered.tar.gz" >"$WORK/import-tamper.log" 2>&1
        check "transfer red: a tampered table is caught by the checksum and rolled back" grep -q "rolled back" "$WORK/import-tamper.log"
        check "transfer red: after it, still no family, no imported file, the secrets as before" bash -c \
          "[ \"\$(docker exec -i kbaio-imp2 psql -X -U supabase_admin -d postgres -tAc 'SELECT count(*) FROM families')\" = 0 ] && [ -z \"\$(docker exec kbaio-imp2 find /data/storage/files -type f)\" ] && ! docker exec kbaio-imp2 sh -c 'ls /data/config/secrets' | grep -q previous"
        # An archive with a path that climbs out of the folder it is extracted to.
        python3 -I - "$WORK/tamper/manifest.json" "$WORK/evil.tar.gz" <<'PY'
import io, sys, tarfile
with tarfile.open(sys.argv[2], "w:gz") as t:
    t.add(sys.argv[1], arcname="manifest.json")
    data = b"owned"
    info = tarfile.TarInfo("files/../../escaped"); info.size = len(data)
    t.addfile(info, io.BytesIO(data))
PY
        docker exec -i kbaio-imp2 kinboard import - <"$WORK/evil.tar.gz" >"$WORK/import-evil.log" 2>&1
        check "transfer red: an archive with a path outside its folders is refused before extraction" grep -qE "refusing this archive|not a plain relative path|unexpected entry" "$WORK/import-evil.log"
        # A hard link to a file of the container's (busybox lists it as a plain file "a -> target").
        python3 -I - "$WORK/tamper/manifest.json" "$WORK/hardlink.tar.gz" <<'PY'
import sys, tarfile
with tarfile.open(sys.argv[2], "w:gz") as t:
    t.add(sys.argv[1], arcname="manifest.json")
    info = tarfile.TarInfo("files/passwd"); info.type = tarfile.LNKTYPE; info.linkname = "etc/passwd"
    t.addfile(info)
PY
        before_mode="$(docker exec kbaio-imp2 stat -c '%a %u' /etc/passwd)"
        docker exec -i kbaio-imp2 kinboard import - <"$WORK/hardlink.tar.gz" >"$WORK/import-hard.log" 2>&1
        check "transfer red: an archive with a hard link is refused, /etc/passwd untouched" bash -c \
          "grep -qE 'refusing this archive' '$WORK/import-hard.log' && [ \"\$(docker exec kbaio-imp2 stat -c '%a %u' /etc/passwd)\" = '$before_mode' ]"
      fi
      docker rm -f kbaio-imp2 >/dev/null 2>&1

      say "transfer: back, all-in-one -> a fresh compose.yml stack"
      if cmp_up kbaio-cmp2 "$P_CMP2" && wait_healthy kbaio-cmp2-webapp; then
        # compose.yml's webapp mounts the config read-only: the import runs in
        # a one-off container with the stack's network and volumes (the wiki's recipe).
        docker run --rm -i --network kbaio-cmp2_kinboard -e POSTGRES_HOST=db -e FILES_DIR=/var/lib/storage/files \
          -v kbaio-cmp2-config:/kinboard -v kbaio-cmp2-storage:/var/lib/storage "$RIG_IMAGE" kinboard import - \
          <"$WORK/aio-after.tar.gz" >"$WORK/import2.log" 2>&1
        check "transfer: kinboard import into a fresh compose stack ($(grep -m1 'imported' "$WORK/import2.log" | sed 's/^\[kinboard\] //' | cut -c1-120))" grep -q 'verified' "$WORK/import2.log"
        cmp_restart kbaio-cmp2 "$P_CMP2"
        sleep 5; wait_http "http://127.0.0.1:$P_CMP2" || fail "transfer: compose not answering after the restart"
        docker exec kbaio-cmp2-webapp kinboard export - >"$WORK/compose-after.tar.gz" 2>/dev/null
        same_data "transfer aio->compose" "$WORK/aio-after.tar.gz" "$WORK/compose-after.tar.gz"
        same_data "transfer compose->aio->compose" "$WORK/from-compose.tar.gz" "$WORK/compose-after.tar.gz"
        check "transfer: the join code works on the compose stack again" joins "http://127.0.0.1:$P_CMP2" "${CMP_CODE:-none}" cmp2-join
        check "transfer: the files belong to the compose webapp's user" test "$(docker exec kbaio-cmp2-webapp stat -c %U /var/lib/storage/files/family-photos/a/photo.jpg)" = nextjs
      else
        fail "transfer: the second compose stack"; tail -20 "$WORK/kbaio-cmp2.up.log" | sed 's/^/     /'
      fi
    else
      fail "transfer: the import target never came up"
    fi
  else
    fail "transfer: the compose stack"; tail -20 "$WORK/kbaio-cmp.up.log" | sed 's/^/     /'
  fi
  for p in kbaio-cmp kbaio-cmp2; do ( cd "$WORK/$p" 2>/dev/null && docker compose -p "$p" down -v >/dev/null 2>&1 ); done
  docker rm -f kbaio-imp >/dev/null 2>&1
fi

# ------------------------------------------------------------------ migrate

if [ "$MAIN_UP" = 1 ] && want migrate; then
  say "migrate: a pending migration on existing data (RFC-024 §4.7)"
  docker stop "$MAIN" >/dev/null
  copy_volume "$MAIN_VOL" kbaio-mig-data
  aio_run kbaio-mig "$P_SIDE" kbaio-mig-data
  wait_healthy kbaio-mig || fail "migrate: the copy did not start"
  last="$(apsql kbaio-mig -c "SELECT name FROM kinboard.schema_migrations ORDER BY name DESC LIMIT 1")"
  apsql kbaio-mig -c "DELETE FROM kinboard.schema_migrations WHERE name = '$last'" >/dev/null
  docker restart kbaio-mig >/dev/null
  if wait_healthy kbaio-mig; then
    check "migrate: $last pending -> a verified dump first ($(logs kbaio-mig | grep -m1 -o 'verified: [^ ]*' ))" bash -c \
      "docker logs kbaio-mig 2>&1 | grep -q '1 migration(s) pending' && docker exec kbaio-mig sh -c 'ls /data/backups/pre-migrate-*.sql.gz' >/dev/null"
    check "migrate: the dump reads back and holds the families table" bash -c "docker exec kbaio-mig sh -c 'gunzip -c /data/backups/pre-migrate-*.sql.gz | grep -q \"^CREATE TABLE public.families \"'"
    check "migrate: the dump is 0600, owned by PUID" bash -c "docker exec kbaio-mig sh -c 'stat -c \"%a %u\" /data/backups/pre-migrate-*.sql.gz' | grep -qx '600 1000'"
  else fail "migrate: not healthy with a pending migration"; fi

  # Red: a dump that fails its verification -> no migration, no start. (A
  # backup folder made unusable is healed by init-perms before this point, so
  # the dump is made to fail its own check: at least 9999 tables.)
  apsql kbaio-mig -c "DELETE FROM kinboard.schema_migrations WHERE name = '$last'" >/dev/null
  docker rm -f kbaio-mig >/dev/null
  aio_run kbaio-mig "$P_SIDE" kbaio-mig-data -e KINBOARD_BACKUP_MIN_TABLES=9999
  wait_exit kbaio-mig 300
  check "migrate red: without a verified dump the migration is not run and the container stops" bash -c \
    "docker logs kbaio-mig 2>&1 | grep -q 'NOT VERIFIED: the dump has only' && docker logs kbaio-mig 2>&1 | grep -q 'REFUSING to migrate without a verified backup' && [ \"\$(docker inspect -f '{{.State.Status}}' kbaio-mig)\" = exited ]"
  check "migrate red: $last was not applied (no 'applying' in the log)" bash -c "! docker logs kbaio-mig 2>&1 | grep -q '\[migrate\] applying $last'"
  docker rm -f kbaio-mig >/dev/null
  aio_run kbaio-mig "$P_SIDE" kbaio-mig-data
  wait_healthy kbaio-mig && check "migrate: with the folder back, the dump and then the migration ($last recorded again)" \
    test "$(apsql kbaio-mig -c "SELECT count(*) FROM kinboard.schema_migrations WHERE name = '$last'")" = 1

  # A newer version whose migration fails: it stops and names the version to go back to.
  say "migrate: a version whose migration fails, then the previous one again"
  printf 'FROM %s\nRUN echo "SELECT 1/0;" > /app/migrations/999_rig_fails.sql && sed -i "s/\\"version\\": \\"[^\\"]*\\"/\\"version\\": \\"9.9.9-rig\\"/" /app/package.json && sed -i "s/^version=.*/version=9.9.9-rig/" /etc/kinboard-aio/build\n' "$AIO_IMAGE" \
    | docker build -q -t "kbaio-rig-aio:broken-$rev" - >/dev/null && BUILT+=("kbaio-rig-aio:broken-$rev")
  docker rm -f kbaio-mig >/dev/null
  aio_run kbaio-mig "$P_SIDE" kbaio-mig-data --image "kbaio-rig-aio:broken-$rev" -e MIGRATION_ATTEMPTS=1
  wait_exit kbaio-mig 300
  check "migrate: the broken version stops ($(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' kbaio-mig))" test "$(docker inspect -f '{{.State.Status}}' kbaio-mig)" = exited
  check "migrate: it took a verified dump before trying" bash -c "docker logs kbaio-mig 2>&1 | grep -q 'taking a verified backup first'"
  goodver="$(in_volume kbaio-mig-data 'sed -n s/^version=//p /data/config/updater/last-good')"
  check "migrate: its log names the version to go back to ($goodver)" bash -c "docker logs kbaio-mig 2>&1 | grep -q 'The last version that ran healthy on this data is $goodver'"
  docker rm -f kbaio-mig >/dev/null
  aio_run kbaio-mig "$P_SIDE" kbaio-mig-data
  if wait_healthy kbaio-mig; then
    rec="$(apsql kbaio-mig -c "SELECT value FROM instance_settings WHERE key = 'update_status'")"
    check "migrate: the previous version starts on the newer schema, and Settings' record says rolled_back from 9.9.9-rig, migration 999_rig_fails.sql" \
      jq -e '.status == "rolled_back" and .to == "9.9.9-rig" and .migration == "999_rig_fails.sql" and .severe == true' <<<"$rec" >/dev/null
    step "record: $(jq -c '{status, from, to, migration, backup}' <<<"$rec" 2>/dev/null)"
  else fail "migrate: the previous version did not start again"; fi
  docker rm -f kbaio-mig >/dev/null
  docker start "$MAIN" >/dev/null; wait_healthy "$MAIN" || MAIN_UP=0
fi

# ------------------------------------------------------------------ upgrade

if [ "$MAIN_UP" = 1 ] && want upgrade; then
  say "upgrade: PostgreSQL 17 -> 18 on a copy of the fresh install's data"
  aio_build "kbaio-rig-aio:pg18-$rev" --build-arg PG_MAJOR=18 --build-arg PG_PREVIOUS_MAJORS=17 && BUILT+=("kbaio-rig-aio:pg18-$rev") \
    || fail "upgrade: the 18-over-17 image did not build"
  PG18="kbaio-rig-aio:pg18-$rev"
  printf 'FROM %s\nRUN rm "$(/usr/libexec/postgresql18/pg_config --pkglibdir)/safeupdate.so"\n' "$PG18" | docker build -q -t "kbaio-rig-aio:pg18-nosafeupdate-$rev" - >/dev/null \
    && BUILT+=("kbaio-rig-aio:pg18-nosafeupdate-$rev")
  docker stop "$MAIN" >/dev/null
  pgver() { in_volume "$1" 'cat /data/db/PG_VERSION'; }
  prev_starts() {  # prev_starts <volume> <label>: the previous tag (17) starts on it, the family there
    aio_run kbaio-prev "$P_SIDE" "$1"
    if wait_healthy kbaio-prev 240 && [ "$(apsql kbaio-prev -c "SELECT count(*) FROM families WHERE id = '${MAIN_FAM:-}'")" = 1 ]; then
      pass "$2: the previous tag (PostgreSQL 17) starts on it, the family there"
    else fail "$2: the previous tag does not start on it"; logs kbaio-prev | tail -15 | sed 's/^/     /'; fi
    docker rm -f kbaio-prev >/dev/null
  }
  # try_upgrade <volume> <image> [docker args]: runs it, returns when healthy or exited
  try_upgrade() { local v="$1" img="$2"; shift 2; aio_run kbaio-up "$P_SIDE" "$v" --image "$img" "$@"; wait_healthy kbaio-up 420; }

  # 1. The dump fails its verification: no upgrade at all.
  copy_volume "$MAIN_VOL" kbaio-up1
  try_upgrade kbaio-up1 "$PG18" -e KINBOARD_BACKUP_MIN_TABLES=9999 && fail "upgrade red 1: upgraded without a verified dump"
  check "upgrade red 1: no verified dump -> refused, the container stopped" bash -c "docker logs kbaio-up 2>&1 | grep -q 'FAILED: no verified dump' && [ \"\$(docker inspect -f '{{.State.Status}}' kbaio-up)\" = exited ]"
  check "upgrade red 1: /data/db still PostgreSQL $(pgver kbaio-up1), no db.new, no db.old" bash -c "[ '$(pgver kbaio-up1)' = 17 ] && [ \"\$(docker run --rm -v kbaio-up1:/data alpine:3 ls /data | tr '\n' ' ')\" = 'backups config db storage ' ]"
  docker rm -f kbaio-up >/dev/null
  prev_starts kbaio-up1 "upgrade red 1"

  # 2. pg_upgrade --check refuses the database (a regproc column), after a verified dump.
  copy_volume "$MAIN_VOL" kbaio-up2
  aio_run kbaio-prev "$P_SIDE" kbaio-up2; wait_healthy kbaio-prev
  apsql kbaio-prev -c "CREATE TABLE public.rig_blocks_upgrade (f regproc); INSERT INTO public.rig_blocks_upgrade VALUES ('now');" >/dev/null
  docker stop kbaio-prev >/dev/null; docker rm kbaio-prev >/dev/null
  try_upgrade kbaio-up2 "$PG18" && fail "upgrade red 2: pg_upgrade accepted a regproc column"
  check "upgrade red 2: pg_upgrade --check refused it, after a verified dump" bash -c "docker logs kbaio-up 2>&1 | grep -q 'pg_upgrade --check refused' && docker logs kbaio-up 2>&1 | grep -q 'verified: /data/backups/pre-pg18-upgrade-'"
  check "upgrade red 2: /data/db still PostgreSQL $(pgver kbaio-up2), db.new removed" bash -c "[ '$(pgver kbaio-up2)' = 17 ] && ! docker run --rm -v kbaio-up2:/data alpine:3 test -e /data/db.new"
  docker rm -f kbaio-up >/dev/null
  aio_run kbaio-prev "$P_SIDE" kbaio-up2; wait_healthy kbaio-prev && apsql kbaio-prev -c "DROP TABLE public.rig_blocks_upgrade" >/dev/null
  docker stop kbaio-prev >/dev/null; docker rm kbaio-prev >/dev/null
  prev_starts kbaio-up2 "upgrade red 2"

  # 3. The upgraded cluster can't load safeupdate: verification fails after pg_upgrade, no switch.
  copy_volume "$MAIN_VOL" kbaio-up3
  try_upgrade kbaio-up3 "kbaio-rig-aio:pg18-nosafeupdate-$rev" && fail "upgrade red 3: switched to a cluster without safeupdate"
  check "upgrade red 3: pg_upgrade ran, the new cluster was checked and refused (no safeupdate)" bash -c "docker logs kbaio-up 2>&1 | grep -q 'Upgrade Complete' && docker logs kbaio-up 2>&1 | grep -q 'cannot load safeupdate'"
  check "upgrade red 3: /data/db still PostgreSQL $(pgver kbaio-up3), no db.new, no db.old" bash -c "[ '$(pgver kbaio-up3)' = 17 ] && ! docker run --rm -v kbaio-up3:/data alpine:3 sh -c 'test -e /data/db.new || test -e /data/db.old'"
  docker rm -f kbaio-up >/dev/null
  prev_starts kbaio-up3 "upgrade red 3"

  # 4. The switch cut off between its two renames.
  copy_volume "$MAIN_VOL" kbaio-up4
  in_volume kbaio-up4 'mv /data/db /data/db.old && cp -a /data/db.old /data/db.new && printf "phase=switching\nfrom=17\nto=18\n" > /data/config/updater/pg-upgrade && chown -R 1000:1000 /data/config/updater'
  prev_starts kbaio-up4 "upgrade red 4 (an interrupted switch put back)"
  check "upgrade red 4: db.old renamed back to db, db.new removed" bash -c "[ \"\$(docker run --rm -v kbaio-up4:/data alpine:3 ls /data | tr '\n' ' ')\" = 'backups config db storage ' ]"

  # 5. The real upgrade.
  copy_volume "$MAIN_VOL" kbaio-up5
  t0=$(date +%s)
  if try_upgrade kbaio-up5 "$PG18"; then
    pass "upgrade: 17 -> 18 and healthy in $(( $(date +%s) - t0 ))s"
    check "upgrade: a verified dump first ($(logs kbaio-up | grep -m1 -o 'verified: [^ ]*'))" bash -c "docker logs kbaio-up 2>&1 | grep -q 'verified: /data/backups/pre-pg18-upgrade-'"
    check "upgrade: the same before and after ($(logs kbaio-up | grep -m1 -o 'tables=[^.]*'))" bash -c "docker logs kbaio-up 2>&1 | grep -q 'the same before and after: tables='"
    check "upgrade: /data/db is 18, /data/db.old 17, nothing else" bash -c "[ '$(pgver kbaio-up5)' = 18 ] && docker run --rm -v kbaio-up5:/data alpine:3 sh -c '[ \$(cat /data/db.old/PG_VERSION) = 17 ] && ! test -e /data/db.new'"
    check "upgrade: the family is there, its join code works" bash -c "[ \"\$(docker exec -i kbaio-up psql -X -U supabase_admin -d postgres -tAc \"SELECT count(*) FROM families WHERE id = '${MAIN_FAM:-}'\")\" = 1 ]"
    joins "http://127.0.0.1:$P_SIDE" "${MAIN_CODE:-none}" up-join && pass "upgrade: join on 18" || fail "upgrade: join on 18"
    check "upgrade: safeupdate on 18 (db-init's role check passed)" bash -c "docker logs kbaio-up 2>&1 | grep -q 'roles checked'"
    # 6. Back to the previous tag before the first healthy minute: 17 comes back.
    # (On a copy taken with the container stopped; if the minute has already
    # passed by then, the copy's record is set back to unconfirmed.)
    docker stop kbaio-up >/dev/null
    copy_volume kbaio-up5 kbaio-up6
    in_volume kbaio-up6 'grep -q "^confirmed_at=$" /data/config/updater/pg-upgrade' \
      || in_volume kbaio-up6 'sed -i "s/^confirmed_at=.*/confirmed_at=/" /data/config/updater/pg-upgrade'
    prev_starts kbaio-up6 "upgrade: back before the first healthy minute"
    check "upgrade: 17 back as /data/db, the 18 cluster set aside, not deleted" bash -c "docker run --rm -v kbaio-up6:/data alpine:3 sh -c '[ \$(cat /data/db/PG_VERSION) = 17 ] && ls -d /data/db.failed-pg18-* >/dev/null'"
    # 7. After the first healthy minute: confirmed, and going back is refused.
    docker start kbaio-up >/dev/null; wait_healthy kbaio-up
    for i in $(seq 1 40); do in_volume kbaio-up5 'grep -q "^confirmed_at=2" /data/config/updater/pg-upgrade' && break; sleep 3; done
    check "upgrade: confirmed after the first healthy minute" bash -c "docker logs kbaio-up 2>&1 | grep -q 'upgrade is confirmed'"
    docker stop kbaio-up >/dev/null
    aio_run kbaio-prev "$P_SIDE" kbaio-up5; wait_exit kbaio-prev 120
    check "upgrade: the previous tag then refuses, names the dump, changes nothing" bash -c "docker logs kbaio-prev 2>&1 | grep -q 'REFUSED: /data/db is PostgreSQL 18, newer' && [ '$(pgver kbaio-up5)' = 18 ]"
    docker rm -f kbaio-prev >/dev/null
    docker start kbaio-up >/dev/null
    check "upgrade: 18 starts again on it" wait_healthy kbaio-up
  else
    fail "upgrade: 17 -> 18"; logs kbaio-up | grep -vE '^\[rest\]' | tail -40 | sed 's/^/     /'
  fi
  docker rm -f kbaio-up >/dev/null 2>&1
  docker start "$MAIN" >/dev/null; wait_healthy "$MAIN" || MAIN_UP=0
fi

# ----------------------------------------------------------------- symlinks

if [ "$MAIN_UP" = 1 ] && want symlinks; then
  say "symlinks: root follows no link the data folder's user planted"
  docker stop "$MAIN" >/dev/null
  copy_volume "$MAIN_VOL" kbaio-sym-data
  # A pending migration (so the pre-migrate record is written), a switch cut
  # off half-way (so recover_switch runs), a root-owned canary and folder, and
  # links owned by the run user (1000) at every name a root step wrote to.
  aio_run kbaio-sym "$P_SIDE" kbaio-sym-data; wait_healthy kbaio-sym
  last="$(apsql kbaio-sym -c "SELECT name FROM kinboard.schema_migrations ORDER BY name DESC LIMIT 1")"
  apsql kbaio-sym -c "DELETE FROM kinboard.schema_migrations WHERE name = '$last'" >/dev/null
  docker stop kbaio-sym >/dev/null; docker rm kbaio-sym >/dev/null
  in_volume kbaio-sym-data '
    set -e
    printf canary > /data/canary-root; chown 0:0 /data/canary-root; chmod 0644 /data/canary-root
    mkdir /data/rootdir; chown 0:0 /data/rootdir; chmod 0755 /data/rootdir
    mv /data/db /data/db.old
    printf "phase=switching
from=17
to=18
" > /data/config/updater/pg-upgrade
    cd /data/config/updater
    for n in attempt pre-migrate pre-migrate.tmp failed failed-migration pg-upgrade.tmp last-good last-good.tmp; do
      rm -f "$n"; ln -s /data/canary-root "$n"; chown -h 1000:1000 "$n"
    done
    chown -h 1000:1000 /data/config/updater/pg-upgrade'
  aio_run kbaio-sym "$P_SIDE" kbaio-sym-data
  wait_healthy kbaio-sym || step "(not healthy: $(docker inspect -f '{{.State.Status}}' kbaio-sym))"
  # Past the first healthy minute, so healthwatch has written its records too.
  sleep 75
  canary="$(in_volume kbaio-sym-data 'stat -c "%u:%g %a" /data/canary-root; cat /data/canary-root')"
  check "symlinks: the root-owned canary is untouched ($(tr '\n' ' ' <<<"$canary"))" test "$canary" = "$(printf '0:0 644\ncanary')"
  check "symlinks: the interrupted switch was put back all the same (db is 17)" bash -c "[ \"\$(docker run --rm -v kbaio-sym-data:/data alpine:3 cat /data/db/PG_VERSION)\" = 17 ]"
  check "symlinks: the pending migration ran after a verified dump" bash -c "docker logs kbaio-sym 2>&1 | grep -q 'verified: /data/backups/pre-migrate-'"
  # An import as root into a files folder with a linked subfolder pointing at a root-owned folder.
  if [ -s "$WORK/from-compose.tar.gz" ]; then archive="$WORK/from-compose.tar.gz"; else
    docker exec kbaio-sym sh -c 'mkdir -p /data/storage/files/family-photos && echo x > /data/storage/files/family-photos/p.jpg && chown -R 1000:1000 /data/storage/files'
    docker exec kbaio-sym kinboard export - >"$WORK/sym-export.tar.gz" 2>/dev/null; archive="$WORK/sym-export.tar.gz"
  fi
  docker rm -f kbaio-sym2 >/dev/null 2>&1
  aio_run kbaio-sym2 "$P_PUID" kbaio-sym2-data; wait_healthy kbaio-sym2
  docker exec kbaio-sym2 sh -c 'mkdir -m 0755 /data/rootdir && su-exec 1000:1000 ln -s /data/rootdir /data/storage/files/family-photos'
  docker exec -i kbaio-sym2 kinboard import --no-restart - <"$archive" >"$WORK/sym-import.log" 2>&1
  check "symlinks: an import into a files folder holding a link is refused, and the root-owned folder stays empty" bash -c \
    "grep -q 'not plain files or folders' '$WORK/sym-import.log' && [ -z \"\$(docker exec kbaio-sym2 ls -A /data/rootdir)\" ]"
  docker rm -f kbaio-sym kbaio-sym2 >/dev/null 2>&1
  docker start "$MAIN" >/dev/null; wait_healthy "$MAIN" || MAIN_UP=0
fi

# ------------------------------------------------------------------ measure

if [ "$MAIN_UP" = 1 ] && want measure; then
  say "measure (this machine, $(uname -m))"
  for img in "$RIG_IMAGE" "$AIO_IMAGE"; do
    # The containerd image store's columns: on disk (unpacked) and the compressed content a pull downloads.
    step "$img: $(docker image ls "$img" | awk 'NR == 2 { print $3 " on disk, " $4 " to download" }')"
  done
  sleep 90
  step "idle, 90 s after the last request: $(docker stats --no-stream --format '{{.MemUsage}}' "$MAIN") (container), per process RSS:"
  # VmRSS from /proc (busybox ps abbreviates large values, "120m").
  docker exec "$MAIN" sh -c 'for d in /proc/[0-9]*; do c="$(cat "$d/comm" 2>/dev/null)"; r="$(awk "/^VmRSS:/ {print \$2}" "$d/status" 2>/dev/null)"; [ -n "$r" ] && echo "$r $c"; done' \
    | awk '{ r = $1; c = $2; k = (c == "postgrest") ? "postgrest" : (c ~ /^postgres/) ? "postgresql (all backends)" : (c ~ /^next-server|^node/) ? "webapp (node)" : "s6, log forwarders, shell"; s[k] += r }
    END { for (k in s) printf "     %-26s %6.1f MiB\n", k, s[k] / 1024 }'
  pass "measure: recorded"
fi
