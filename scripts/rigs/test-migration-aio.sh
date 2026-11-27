#!/usr/bin/env bash
# test-migration-aio.sh: moving a household's Kinboard to the all-in-one image
# and back, end to end, the way a household does it (RFC-024 §4.4), with a
# real browser where a person would click (e2e/migration-aio.spec.ts).
#
#   fresh     (A) the all-in-one image on an empty folder: a family created
#             through /join and every first-run step, a todo, a shopping item,
#             a note and a photo typed in, a second device joined with the
#             code, a change on one screen arriving on the other; Chromium on
#             one install, WebKit on another. Then `docker restart`: both
#             devices still signed in, everything still there, Settings'
#             version and /api/health, every page without a console error
#   legacy    (B) a git install of LEGACY_TAG (v1.17.0) exactly as users have
#             it: `git clone`, `setup.sh`, webapp/docker/docker-compose.yml on
#             supabase/postgres 15, onboarded in the browser, an image in every
#             upload bucket, seed-demo.sql plus migration-aio/fill-every-table.sql
#             so that every table holds rows. Updated the documented way
#             (`git pull`, `./start.sh up`, on the image under test), then
#             `kinboard export`, an all-in-one on an empty folder, `kinboard
#             import`, and: every table by row count and checksum, computed
#             here (migration-aio/table-checksums.sql) and not taken from the
#             archive; every file by SHA-256; the secrets that travel; push
#             subscriptions still on their key; an integration token made
#             before the move still answering; the devices signed in before
#             the move (their cookies replayed) still signed in; the join code;
#             live updates; the PIN; the scheduler; every page in Chromium and
#             WebKit without a console error. The source started again
#             afterwards: unchanged, its devices still signed in
#   onefile   (C) the same from a one-file compose.yml install, then back:
#             all-in-one -> a fresh compose.yml install (the wiki's recipe)
#   errors    (D) what must be refused or undone, each ending where the
#             household can go on: a non-empty target; a truncated, a random,
#             an empty archive; a tampered table checksum and a changed file;
#             paths outside the archive, a symlink, a hard link; another
#             version in both directions (an image with one migration more);
#             the container SIGKILLed while the import stages files, after it
#             replaced a secret, and during the database transaction, then
#             started again and imported again; /data filling up during the
#             files and during the database, then imported once there is room;
#             the image pointed at a compose install's database folder (a copy:
#             refused, and the folder left as it was); a /data owned by
#             another uid than PUID
#   docs      (E) docs/wiki/All-in-one.md's move commands run as written: the
#             only changes are the names and ports this rig must use, each
#             listed in the output
#   copy      (F, only when asked) a copy of a real household's backup through
#             the same move, PostgreSQL 15 to 17: restored into the git install
#             the documented way, updated, exported, imported; every table and
#             file compared, the browser smoke, the scheduler. No connection
#             leaves its containers (iptables, checked before the data goes
#             in); nothing of the data is printed
#
# Usage:
#   KINBOARD_RIG=1 scripts/rigs/test-migration-aio.sh
#   RIG_IMAGE=<image:tag>   the webapp image (default: built from this checkout)
#   AIO_IMAGE=<image:tag>   the all-in-one image (default: built FROM RIG_IMAGE)
#   LEGACY_TAG=v1.17.0      the release the git install starts on
#   RIG_PHASES="fresh legacy onefile errors docs"   a subset (errors needs legacy)
#   RIG_BULK_ROWS=400000    rows added before the SIGKILL and disk-full tests,
#   RIG_BULK_MB=300         and MB of photos: what makes those phases last long
#                           enough to be interrupted
#   RIG_COPY_DUMP=<.sql.gz> RIG_COPY_FILES=<.tar.gz>   for the copy phase:
#                           a pg_dumpall of a compose install and its storage
#                           archive; add `copy` to RIG_PHASES
#   RIG_DOCS_DIR=<dir>      the wiki pages the docs phase follows (default docs/wiki)
#   RIG_REPORT=<file>       also write the numbers there (key=value lines)
#   KEEP_FAILED=1           leave everything after a failure
#
# Isolation: every container, volume, network, compose project and image it
# makes is named kbmig-* (images labelled kb.agent=kbmig-rig), on ports
# 3081-3093 and 5481 and the subnet 10.224.0.0/24. It refuses to start while
# anything named kbmig-* exists or one of its ports is taken, and removes by
# name only what it made: never a prune. The git install is a clone in its own
# temporary folder; this checkout is not changed (compared before and after).
# The disk-full test mounts loop files and needs sudo; without it, that test
# is skipped and says so.

set -uo pipefail

RIG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=rig-intent.sh
. "$RIG_DIR/rig-intent.sh"
rig_require_intent "$@"; set -- "${RIG_ARGS[@]}"
REPO_ROOT="$(cd "$RIG_DIR/../.." && pwd)"
DOCKER_DIR="$REPO_ROOT/webapp/docker"
# Where the image's build sources live (Dockerfile, aio/): one place to change
# if they move out of webapp/docker.
IMAGE_SRC="$DOCKER_DIR"
for d in "$REPO_ROOT/webapp/image" "$DOCKER_DIR"; do [ -f "$d/Dockerfile" ] && { IMAGE_SRC="$d"; break; }; done
SEED_SQL=""
for f in "$DOCKER_DIR/seed-demo.sql" "$IMAGE_SRC/seed-demo.sql"; do [ -f "$f" ] && { SEED_SQL="$f"; break; }; done
HERE="$RIG_DIR/migration-aio"
WEBAPP="$REPO_ROOT/webapp"

RIG_PHASES="${RIG_PHASES:-fresh legacy onefile errors docs}"
LEGACY_TAG="${LEGACY_TAG:-v1.17.0}"
RIG_BULK_ROWS="${RIG_BULK_ROWS:-400000}"
RIG_BULK_MB="${RIG_BULK_MB:-300}"
KEEP_FAILED="${KEEP_FAILED:-0}"
PUBLISHED="ghcr.io/svenger87/kinboard"
LABEL=kb.agent=kbmig-rig
P_LEG=3081 P_LEGDB=5481 P_AIO=3082 P_ERR=3083 P_NEW=3084 P_KILL=3085 P_FULL=3086 P_PUID=3087
P_ONE=3088 P_ONE2=3089 P_FRESH=3090 P_FRESH2=3091 P_DOCS=3092 P_DOCSCMP=3093
PORTS=($P_LEG $P_LEGDB $P_AIO $P_ERR $P_NEW $P_KILL $P_FULL $P_PUID $P_ONE $P_ONE2 $P_FRESH $P_FRESH2 $P_DOCS $P_DOCSCMP 19841)
SUBNET=10.224.0.0/24
PIN=2468

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
step() { printf '   %s\n' "$*"; }
FAILURES=()
CHECKS=0
METRICS=()
fail() { red "   FAIL: $*"; FAILURES+=("$*"); CHECKS=$((CHECKS + 1)); }
pass() { grn "   ok:   $*"; CHECKS=$((CHECKS + 1)); }
check() { local what="$1"; shift; if "$@"; then pass "$what"; else fail "$what"; fi; }
metric() { METRICS+=("$1=$2"); step "metric $1=$2"; }
want() { case " $RIG_PHASES " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
SLOT=(); command -v kinboard-heavy-slot >/dev/null && SLOT=(kinboard-heavy-slot)
now() { date +%s.%N; }
since() { printf '%.1f' "$(echo "$(now) - $1" | bc)"; }

WORK=""
BUILT=()
LOOPS=()
IPT_RULES=()
GIT_BEFORE=""

# ------------------------------------------------------------------ cleanup

kbmig_containers() { docker ps -a --format '{{.Names}}' | grep -E '^kbmig-' || true; }
cleanup_all() {
  local p
  for p in kbmig-legacy kbmig-one kbmig-one2 kbmig-docscmp; do
    [ -d "$WORK/$p" ] && ( cd "$WORK/$p" && docker compose -p "$p" down -v --remove-orphans >/dev/null 2>&1 )
  done
  if [ -d "$WORK/kinboard/webapp/docker" ]; then
    ( cd "$WORK/kinboard/webapp/docker" && docker compose -p kbmig-legacy down -v --remove-orphans >/dev/null 2>&1 )
  fi
  kbmig_containers | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker volume ls --format '{{.Name}}' | grep -E '^kbmig-' | xargs -r docker volume rm >/dev/null 2>&1 || true
  docker network ls --format '{{.Name}}' | grep -E '^kbmig' | xargs -r docker network rm >/dev/null 2>&1 || true
  for p in "${LOOPS[@]}"; do sudo -n umount "$p" >/dev/null 2>&1 || true; done
  for sn in "${IPT_RULES[@]}"; do
    sudo -n iptables -D DOCKER-USER -s "$sn" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN >/dev/null 2>&1 || true
    sudo -n iptables -D DOCKER-USER -s "$sn" ! -d "$sn" -j DROP >/dev/null 2>&1 || true
  done
}
on_exit() {
  local rc=$?
  trap - EXIT INT TERM
  if [ "$KEEP_FAILED" = 1 ] && [ ${#FAILURES[@]} -gt 0 ]; then
    red "KEEP_FAILED=1: kbmig-* left up; work folder $WORK"
    WORK=""
  else
    cleanup_all
    local i; for i in "${BUILT[@]}"; do docker image rm "$i" >/dev/null 2>&1 || true; done
  fi
  if [ -n "$WORK" ]; then
    # Bind-mounted data belongs to other uids by now: removed from a container.
    docker run --rm -v "$WORK:/w" alpine:3 sh -c 'rm -rf /w/* /w/.[!.]*' >/dev/null 2>&1 || true
    rm -rf "$WORK"
  fi
  if [ -n "$GIT_BEFORE" ] && [ "$(git -C "$REPO_ROOT" status --porcelain=v1 2>/dev/null)" != "$GIT_BEFORE" ]; then
    red "   the checkout changed during the run"; [ "$rc" = 0 ] && rc=1
  fi
  echo
  if [ ${#METRICS[@]} -gt 0 ]; then
    say "numbers"; printf '   %s\n' "${METRICS[@]}"
    [ -n "${RIG_REPORT:-}" ] && printf '%s\n' "${METRICS[@]}" "checks=$CHECKS" "failed=${#FAILURES[@]}" >"$RIG_REPORT"
  fi
  if [ ${#FAILURES[@]} -gt 0 ]; then say "failed"; printf '   - %s\n' "${FAILURES[@]}"; fi
  if [ ${#FAILURES[@]} -eq 0 ] && [ "$rc" = 0 ]; then grn "test-migration-aio: $CHECKS checks, all passed"; else red "test-migration-aio: $CHECKS checks, ${#FAILURES[@]} failed"; [ "$rc" = 0 ] && rc=1; fi
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ---------------------------------------------------------------- preflight

say "Moving Kinboard to the all-in-one image, and back (RFC-024 §4.4)"
for tool in docker curl jq git bc sha256sum ss; do command -v "$tool" >/dev/null || { red "needs $tool"; exit 1; }; done
[ -n "$SEED_SQL" ] || { red "no seed-demo.sql found"; exit 1; }
[ -x "$WEBAPP/node_modules/.bin/playwright" ] || { red "needs the webapp's node_modules (npm ci in webapp/)"; exit 1; }
# `grep -q < <(…)`, never `… | grep -q`: under pipefail -q's early exit kills the writer.
if [ -n "$(kbmig_containers)" ] || grep -qE '^kbmig-' < <(docker volume ls --format '{{.Name}}') \
   || grep -qE '^kbmig' < <(docker network ls --format '{{.Name}}'); then
  red "kbmig-* containers, volumes or networks exist: another run of this rig? Remove them by name first."; exit 1
fi
for p in "${PORTS[@]}"; do
  grep -qE "[:.]${p}\$" < <(ss -lnt 2>/dev/null | awk '{print $4}') && { red "port $p is in use"; exit 1; }
done
if grep -q "$SUBNET" < <(docker network inspect $(docker network ls -q) -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' 2>/dev/null); then
  red "the subnet $SUBNET is taken by another Docker network"; exit 1
fi
git -C "$REPO_ROOT" rev-parse -q --verify "refs/tags/$LEGACY_TAG" >/dev/null || { red "no tag $LEGACY_TAG in this checkout (fetch the tags)"; exit 1; }
GIT_BEFORE="$(git -C "$REPO_ROOT" status --porcelain=v1 2>/dev/null)" || GIT_BEFORE=""
WORK="$(mktemp -d "${TMPDIR:-/tmp}/kbmig.XXXXXX")"
chmod 755 "$WORK"
STATE="$WORK/browser"; mkdir -p "$STATE"
rev="$(git -C "$REPO_ROOT" rev-parse --short=7 HEAD)"

if [ -z "${RIG_IMAGE:-}" ]; then
  RIG_IMAGE="kbmig-rig-webapp:$rev"
  say "Building the webapp image ($RIG_IMAGE)"
  "${SLOT[@]}" docker build -q --label "$LABEL" --build-arg BUILD_REVISION="$rev" -f "$IMAGE_SRC/Dockerfile" -t "$RIG_IMAGE" "$WEBAPP" >/dev/null \
    || { red "webapp build failed"; exit 1; }
  BUILT+=("$RIG_IMAGE")
fi
if [ -z "${AIO_IMAGE:-}" ]; then
  AIO_IMAGE="kbmig-rig-aio:$rev"
  say "Building the all-in-one image ($AIO_IMAGE)"
  "${SLOT[@]}" docker build -q --label "$LABEL" --build-arg APP_IMAGE="$RIG_IMAGE" --build-arg BUILD_REVISION="$rev" \
    -f "$IMAGE_SRC/aio/Dockerfile" -t "$AIO_IMAGE" "$IMAGE_SRC/aio" >/dev/null || { red "all-in-one build failed"; exit 1; }
  BUILT+=("$AIO_IMAGE")
fi
img_rev() { docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$1" 2>/dev/null | cut -c1-7; }
step "webapp $RIG_IMAGE ($(img_rev "$RIG_IMAGE")); all-in-one $AIO_IMAGE ($(img_rev "$AIO_IMAGE")); this checkout $rev"
[ "$(img_rev "$RIG_IMAGE")" = "$(img_rev "$AIO_IMAGE")" ] || red "   warning: the two images were built from different commits"
# The git install's compose file names the published repository: the image
# under test is tagged into it locally (start.sh's pull of that tag fails and
# it starts what it has, as on an offline box).
if [ "${RIG_IMAGE%:*}" = "$PUBLISHED" ]; then
  NEW_TAG="${RIG_IMAGE##*:}"
else
  NEW_TAG="kbmig-rig-$rev"
  docker tag "$RIG_IMAGE" "$PUBLISHED:$NEW_TAG" && BUILT+=("$PUBLISHED:$NEW_TAG")
fi

# ------------------------------------------------------------------ helpers

# aio_run <name> <port> <folder> [docker run args...]: the wiki's docker run.
aio_run() {
  local name="$1" port="$2" data="$3"; shift 3
  local image="$AIO_IMAGE"
  if [ "${1:-}" = --image ]; then image="$2"; shift 2; fi
  mkdir -p "$data"
  docker run -d --name "$name" --label "$LABEL" --stop-timeout 60 -p "127.0.0.1:$port:3000" -v "$data:/data" \
    -e TZ=Europe/Berlin -e SESSION_RATE_LIMIT_PER_MINUTE=1000 "$@" "$image" >/dev/null
}
wait_healthy() {  # wait_healthy <container> [seconds]
  local name="$1" max="${2:-420}" i st
  for ((i = 0; i < max; i += 2)); do
    st="$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$name" 2>/dev/null)"
    case "$st" in
      "running healthy") return 0 ;;
      exited*) step "$name exited ($(docker inspect -f '{{.State.ExitCode}}' "$name"))"; return 1 ;;
    esac
    sleep 2
  done
  step "$name not healthy within ${max}s ($st)"; return 1
}
wait_exit() { local i; for ((i = 0; i < ${2:-120}; i += 2)); do [ "$(docker inspect -f '{{.State.Status}}' "$1" 2>/dev/null)" = exited ] && return 0; sleep 2; done; return 1; }
wait_http() {  # wait_http <base url>: /api/health with db:true
  local i; for i in $(seq 1 90); do curl -sf --max-time 3 "$1/api/health" | jq -e '.db == true' >/dev/null 2>&1 && return 0; sleep 2; done; return 1
}
sql() { local c="$1"; shift; docker exec -i "$c" psql -X -q -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -tA "$@"; }
checksums() { sql "$1" <"$HERE/table-checksums.sql"; }
# Tables a running install writes by itself, minutes after an import or an
# export: the scheduler's heartbeats and notification runs (sent_at, status),
# the attention engine and its events, and instance_settings, where an import
# adds its nonce. Compared by their keys instead: every row of the source is
# there (by primary key); the rest of the tables strictly.
APP_WRITTEN="system_heartbeats instance_settings scheduled_notifications notification_logs attention_items domain_events"
VOLATILE="^public\.($(tr ' ' '|' <<<"$APP_WRITTEN")) "
keys_of() {  # keys_of <db container> <table>: the primary keys, one per line, sorted
  sql "$1" -c "SELECT string_agg(a.attname, ',' ORDER BY a.attnum) FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey) WHERE i.indrelid = 'public.$2'::regclass AND i.indisprimary" \
    | { read -r cols; sql "$1" -c "SELECT ($cols)::text FROM public.$2 ORDER BY 1"; }
}
# snapshot <db container> <name>: the source as it is exported (right before
# the export): every table's checksum, the keys of the app-written ones and
# the instance settings. The source keeps running after it, as a household's does.
snapshot() {
  local t
  checksums "$1" >"$WORK/$2.sums"
  for t in $APP_WRITTEN; do keys_of "$1" "$t" >"$WORK/$2.keys.$t"; done
  settings_sum "$1" >"$WORK/$2.settings"
}
keys_kept() {  # keys_kept <label> <snapshot name> <target container>
  local t missing=""
  for t in $APP_WRITTEN; do
    [ -z "$(comm -23 "$WORK/$2.keys.$t" <(keys_of "$3" "$t"))" ] || missing+=" $t"
  done
  check "$1: the rows the app itself writes to are all there by key ($APP_WRITTEN)${missing:+; missing in:$missing}" test -z "$missing"
}
settings_sum() { sql "$1" -c "SELECT md5(string_agg(key || '=' || value::text, ',' ORDER BY key)) FROM instance_settings WHERE key NOT IN ('import_nonce')"; }
same_tables() {  # same_tables <label> <snapshot name> <target container>
  local a="$WORK/$1.a" b="$WORK/$1.b"
  grep -vE "$VOLATILE" "$WORK/$2.sums" >"$a"; checksums "$3" | grep -vE "$VOLATILE" >"$b"
  local n rows; n="$(wc -l <"$a")"; rows="$(awk '{s += $2} END {print s}' "$a")"
  if [ "$n" -gt 0 ] && diff "$a" "$b" >"$WORK/$1.diff"; then
    pass "$1: every table the same, rows and checksums ($n tables, $rows rows, computed on both databases)"
  else
    fail "$1: tables differ ($n tables)"; head -10 "$WORK/$1.diff" | sed 's/^/     /'
  fi
  keys_kept "$1" "$2" "$3"
  check "$1: instance settings the same (the import's nonce aside)" test "$(cat "$WORK/$2.settings")" = "$(settings_sum "$3")"
  metric "$1.tables" "$n"; metric "$1.rows" "$rows"
}
# sha256 of every uploaded file: "<sha>  ./<path>", sorted. From a container
# with the folder, whoever owns it.
files_in_container() { docker exec "$1" sh -c "cd '$2' && find . -type f ! -path './.kinboard-*' -exec sha256sum {} +" | sort -k2; }
files_in_folder() { docker run --rm -v "$1:/f:ro" alpine:3 sh -c 'cd /f && find . -type f ! -path "./.kinboard-*" -exec sha256sum {} +' | sort -k2; }
files_in_volume() { docker run --rm -v "$1:/v:ro" alpine:3 sh -c 'cd /v/files && find . -type f -exec sha256sum {} +' | sort -k2; }
same_files() {  # same_files <label> <listing a> <listing b>
  local n; n="$(wc -l <"$2")"
  if [ "$n" -gt 0 ] && diff "$2" "$3" >/dev/null; then pass "$1: every uploaded file byte for byte ($n files, SHA-256)"; else fail "$1: files differ ($n vs $(wc -l <"$3"))"; diff "$2" "$3" | head -5 | sed 's/^/     /'; fi
  metric "$1.files" "$n"
}
secret_files() { docker exec "$1" sh -c 'cd /data/config/secrets && for f in jwt_secret vapid_public_key vapid_private_key cron_secret presence_sensor_token; do printf "%s=" "$f"; cat "$f"; echo; done'; }
env_secrets() {  # from a git install's .env, in secret_files' shape
  local e="$1"
  for p in JWT_SECRET:jwt_secret VAPID_PUBLIC_KEY:vapid_public_key VAPID_PRIVATE_KEY:vapid_private_key CRON_SECRET:cron_secret PRESENCE_SENSOR_TOKEN:presence_sensor_token; do
    printf '%s=%s\n' "${p#*:}" "$(sed -n "s/^${p%%:*}=//p" "$e" | tail -1 | tr -d "\"'")"
  done
}
volume_secrets() { docker run --rm -v "$1:/k:ro" alpine:3 sh -c 'cd /k/secrets && for f in jwt_secret vapid_public_key vapid_private_key cron_secret presence_sensor_token; do printf "%s=" "$f"; cat "$f"; echo; done'; }
secrets_hash() { docker exec "$1" sh -c 'cd /data/config/secrets && sha256sum $(ls | grep -v "^\." | sort)'; }
# pw <phase> <base url> <label> <project...> [-- ENV=value...]: the browser spec.
pw() {
  local phase="$1" base="$2" label="$3"; shift 3
  local projects=() envs=()
  while [ $# -gt 0 ] && [ "$1" != -- ]; do projects+=("--project=$1"); shift; done
  [ "${1:-}" = -- ] && { shift; envs=("$@"); }
  local log="$WORK/pw-$phase-$label.log" t0; t0=$(now)
  ( cd "$WEBAPP" && env KBMIG_PHASE="$phase" KBMIG_BASE_URL="$base" KBMIG_STATE_DIR="$STATE" KBMIG_LABEL="$label" KBMIG_PIN="$PIN" \
      PLAYWRIGHT_AUTOSTART_DEV= "${envs[@]}" "${SLOT[@]}" ./node_modules/.bin/playwright test e2e/migration-aio.spec.ts \
      "${projects[@]}" --reporter=line --output="$WORK/pw-results-$phase-$label" ) >"$log" 2>&1
  local rc=$? summary
  summary="$(sed 's/\x1b\[[0-9;]*[A-Za-z]//g' "$log" | grep -E '^\s+[0-9]+ (passed|failed|flaky)' | sed 's/^ *//' | tr '\n' ' ')"
  metric "browser.$phase.$label" "${summary:-none} in $(since "$t0")s"
  # A household's copy (KBMIG_PRIVATE=1): what failed is not shown, only that it did.
  if [ $rc -ne 0 ] && [[ " ${envs[*]} " != *" KBMIG_PRIVATE=1 "* ]]; then sed 's/\x1b\[[0-9;]*[A-Za-z]//g' "$log" | grep -E '^\s+(Error|Expected|Received|\+|-)' | head -25 | sed 's/^/     /'; fi
  return $rc
}
join_ok() {  # join_ok <base> <code> <name>: the code lets a new device in
  [ -n "$(curl -s -X POST "$1/api/session/join" -H 'content-type: application/json' \
    -d "{\"joinCode\":\"$2\",\"hardwareId\":\"claude-mig-$3\",\"deviceName\":\"claude-mig-$3\"}" | jq -r '.family.id // empty')" ]
}
session_cookie() { jq -r '.cookies[] | select(.name == "kinboard_session") | "kinboard_session=\(.value)"' "$1"; }
# An image into every upload bucket, through the app's own routes, and files
# whose names and sizes a copy can get wrong.
fill_files() {  # fill_files <base> <device state file> <family id> <webapp container> <files dir in it> <owner>
  local base="$1" cookie fam="$3" img="$WEBAPP/public/icons/icon-512.png" r ok=0
  cookie="$(session_cookie "$2")"
  for r in recipes/upload-image vehicles/upload-image pocket-money/goal-image-upload catalogue/upload-image; do
    curl -sf -b "$cookie" -F "image=@$img;type=image/png" --form-string "family_id=$fam" "$base/api/$r" | jq -e .url >/dev/null && ok=$((ok + 1))
  done
  check "an image uploaded into each bucket through the app ($ok of 4, plus the photo from the browser)" test "$ok" = 4
  docker exec -u 0 "$4" sh -c "d='$5/recipe-images/odd'; mkdir -p \"\$d\" && : >\"\$d/empty.jpg\" \
    && printf x >\"\$d/Grüße mit Leerzeichen.jpg\" && head -c 5242880 /dev/urandom >\"\$d/big.jpg\" && chown -R $6 '$5'"
}
fill_tables() {  # fill_tables <db container>: the demo family, then every empty table
  docker exec -i "$1" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 <"$SEED_SQL" >/dev/null && sql "$1" <"$HERE/fill-every-table.sql" >/dev/null
  local empty; empty="$(checksums "$1" | awk '$2 == 0 {print $1}' | tr '\n' ' ')"
  check "every table holds rows ($(checksums "$1" | wc -l) tables${empty:+; empty: $empty})" test -z "$empty"
}
# A token an integration uses (Home Assistant, the assistant), made through
# Settings' route before the move and used after it.
make_token() {  # make_token <base> <device state file> <family id> -> the token
  local cookie; cookie="$(session_cookie "$2")"
  curl -s -b "$cookie" -X POST "$1/api/pin" -H 'content-type: application/json' -d "{\"family_id\":\"$3\",\"action\":\"verify\",\"pin\":\"$PIN\"}" >/dev/null
  curl -s -b "$cookie" -X POST "$1/api/integration-tokens" -H 'content-type: application/json' \
    -d '{"name":"claude-mig token","scopes":["family:read"]}' | jq -r '.secret // empty'
}
token_ok() { [ "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $2" "$1/api/integration/v1/info")" = 200 ]; }
scheduler_ran() {  # scheduler_ran <aio container> <after epoch>: a job finished since
  local i
  for i in $(seq 1 45); do
    docker logs --since "$2" "$1" 2>&1 | grep -qE 'Job "process-notifications".*Finished in .*failed: false' && return 0
    sleep 2
  done
  return 1
}
fam_of() { jq -r ".$2" "$STATE/family-$1.json"; }

# A compose.yml (one-file) stack under kbmig names: compose.yml fixes its
# container and volume names, so an override renames them, and go2rtc (its
# fixed UDP port) is not started.
one_up() {  # one_up <project> <port>
  local p="$1" d="$WORK/$1"
  mkdir -p "$d"; cp "$REPO_ROOT/compose.yml" "$d/compose.yml"
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
  ( cd "$d" && env -i PATH="$PATH" HOME="$HOME" KINBOARD_IMAGE="${RIG_IMAGE%:*}" KINBOARD_TAG="${RIG_IMAGE##*:}" WEBAPP_PORT="$2" \
      timeout 600 docker compose -p "$p" up -d init db db-init rest webapp ) >"$WORK/$p.up.log" 2>&1 && wait_healthy "$p-webapp"
}
one_compose() { local p="$1" port="$2"; shift 2; ( cd "$WORK/$p" && env -i PATH="$PATH" HOME="$HOME" KINBOARD_IMAGE="${RIG_IMAGE%:*}" KINBOARD_TAG="${RIG_IMAGE##*:}" WEBAPP_PORT="$port" timeout 300 docker compose -p "$p" "$@" ); }

# verify_aio <label> <source snapshot> <source files listing> <expected secrets> <target container>
verify_aio() {
  local l="$1" src="$2" srcfiles="$3" want_secrets="$4" c="$5"
  same_tables "$l" "$src" "$c"
  files_in_container "$c" /data/storage/files >"$WORK/$l.files"
  same_files "$l" "$srcfiles" "$WORK/$l.files"
  check "$l: the five secrets that travel arrived (login key, push pair, cron, presence)" diff <(echo "$want_secrets") <(secret_files "$c")
  check "$l: every file is the server's own (PUID 1000)" test -z "$(docker exec "$c" find /data/storage/files ! -user 1000 -print -quit)"
  check "$l: push subscriptions still on the key they were made with, none switched off" \
    test "$(sql "$c" -c "SELECT count(*) FILTER (WHERE vapid_key_retired_at IS NOT NULL) || ' ' || count(*) FILTER (WHERE vapid_key_fingerprint = (SELECT value FROM instance_settings WHERE key = 'push_vapid_key')) || ' ' || count(*) FROM push_subscriptions" | awk '{print ($1 == 0 && $2 == $3)}')" = 1
  check "$l: the scheduler runs its jobs after the import" scheduler_ran "$c" "$IMPORT_AT"
}

# ==================================================================== A: fresh

if want fresh; then
  say "A: a new household on the all-in-one image"
  for b in chromium webkit; do
    name="kbmig-fresh-$b"; port=$P_FRESH; [ "$b" = webkit ] && port=$P_FRESH2
    proj=desktop; [ "$b" = webkit ] && proj=webkit
    t0=$(now); aio_run "$name" "$port" "$WORK/$name"
    if ! wait_healthy "$name"; then fail "A/$b: never healthy"; docker logs "$name" 2>&1 | tail -20 | sed 's/^/     /'; continue; fi
    metric "A.$b.first_start_s" "$(since "$t0")"
    url="http://127.0.0.1:$port"
    check "A/$b: /api/setup/status says there is no family yet" bash -c "curl -s $url/api/setup/status | jq -e '.hasFamilies == false' >/dev/null"
    check "A/$b: onboarding in the browser (family, first-run steps, PIN, todo, shopping, note, photo, second device, live update)" pw onboard "$url" "fresh-$b" "$proj"
    [ -f "$STATE/family-fresh-$b.json" ] || continue
    # WebKit on a Linux host may report navigator.onLine false; the shopping list then queues offline (spec).
    metric "A.$b.browser_reported_offline" "$(jq -r '.itemOffline // false' "$STATE/family-fresh-$b.json")"
    check "A/$b: the photo is in /data/storage/files" test -n "$(docker exec "$name" find /data/storage/files/family-photos -type f -print -quit)"
    sum0="$(checksums "$name" | grep -vE "$VOLATILE")"
    t0=$(now); docker restart -t 60 "$name" >/dev/null
    wait_healthy "$name" && wait_http "$url"; metric "A.$b.restart_s" "$(since "$t0")"
    check "A/$b: after a restart, every table as before" test "$sum0" = "$(checksums "$name" | grep -vE "$VOLATILE")"
    check "A/$b: after a restart, both devices still signed in, data, join code, PIN, live updates" \
      pw verify "$url" "fresh-$b" "$proj" -- KBMIG_EXPECT_SESSIONS=kept
    health="$(curl -s "$url/api/health")"
    check "A/$b: /api/health ok with the database ($health)" jq -e '.status == "ok" and .db == true' <<<"$health" >/dev/null
    check "A/$b: every page without a console error" pw smoke "$url" "fresh-$b" "$proj"
    check "A/$b: the server never failed to write its cache (EACCES on /app/.next)" bash -c "! docker logs $name 2>&1 | grep -q 'EACCES.*/app/.next'"
    docker rm -f "$name" >/dev/null
  done
fi

# =================================================================== B: legacy

LEG="$WORK/kinboard"
LEG_DOCKER="$LEG/webapp/docker"
LEG_DATA="$WORK/legacy-data"
leg() { ( cd "$LEG_DOCKER" && "$@" ); }
set_env() { if grep -q "^$1=" "$LEG_DOCKER/.env"; then sed -i "s|^$1=.*|$1=$2|" "$LEG_DOCKER/.env"; else echo "$1=$2" >>"$LEG_DOCKER/.env"; fi; }
LEG_URL="http://127.0.0.1:$P_LEG"
LEGACY_ARCHIVE="$WORK/legacy-export.tar.gz"
B_UP=0

# legacy_setup: the git install, cloned at LEGACY_TAG, setup.sh, ./start.sh up. Sets B_UP.
legacy_setup() {
  say "a git install of $LEGACY_TAG, as users have it"
  # git clone; this checkout stands in for GitHub, so `git pull` brings what is under test.
  git clone -q "$REPO_ROOT" "$LEG" 2>/dev/null && git -C "$LEG" checkout -q -B main "$LEGACY_TAG" \
    || { fail "B: git clone at $LEGACY_TAG"; return 1; }
  head_branch="$(git -C "$REPO_ROOT" symbolic-ref -q --short HEAD || true)"
  if [ -n "$head_branch" ]; then git -C "$LEG" branch -q -u "origin/$head_branch" main; PULL=(git pull -q --ff-only); else PULL=(git pull -q --ff-only origin HEAD); fi
  ( cd "$LEG" && ./setup.sh --non-interactive >"$WORK/setup.log" 2>&1 ) || { fail "B: setup.sh"; tail -5 "$WORK/setup.log"; }
  set_env PROJECT_NAME kbmig-legacy; set_env COMPOSE_PROJECT_NAME kbmig-legacy; set_env DATA_DIR "$LEG_DATA"
  set_env WEBAPP_PORT "$P_LEG"; set_env POSTGRES_PORT "$P_LEGDB"; set_env NETWORK_SUBNET "$SUBNET"
  set_env GO2RTC_HTTP_PORT 19841; set_env GO2RTC_WEBRTC_PORT 18555; set_env SESSION_RATE_LIMIT_PER_MINUTE 1000
  set_env SITE_URL "$LEG_URL"; set_env KINBOARD_TAG "${LEGACY_TAG#v}"
  step "the install's .env: kbmig-legacy, port $P_LEG, data $LEG_DATA, image ${LEGACY_TAG#v}"
  t0=$(now)
  if leg ./start.sh up >"$WORK/legacy-up.log" 2>&1 && wait_healthy kbmig-legacy-webapp && wait_http "$LEG_URL"; then
    B_UP=1; metric "B.legacy_up_s" "$(since "$t0")"
    pass "B: $LEGACY_TAG up on supabase/postgres 15 ($(curl -s "$LEG_URL/api/health" | jq -r .version))"
  else
    fail "B: $LEGACY_TAG never came up"; tail -20 "$WORK/legacy-up.log" | sed 's/^/     /'
  fi
}
if want legacy || want errors; then legacy_setup; fi

if [ "$B_UP" = 1 ]; then
  check "B: onboarding on $LEGACY_TAG in the browser" pw onboard "$LEG_URL" legacy desktop
  LFAM="$(fam_of legacy id)"
  fill_files "$LEG_URL" "$STATE/device-legacy-chromium-1.json" "$LFAM" kbmig-legacy-webapp /var/lib/storage/files nextjs:nodejs
  fill_tables kbmig-legacy-db

  say "B: the update, the documented way"
  ( umask 077; docker exec kbmig-legacy-webapp kinboard export - >"$WORK/on-legacy.tar.gz" 2>"$WORK/on-legacy.err" ); rc=$?
  check "B: $LEGACY_TAG has no kinboard export (exit $rc): the install must be updated first" test "$rc" != 0
  t0=$(now)
  ( cd "$LEG" && "${PULL[@]}" ) >"$WORK/git-pull.log" 2>&1 || { fail "B: git pull"; tail -5 "$WORK/git-pull.log"; }
  set_env KINBOARD_TAG "$NEW_TAG"
  if leg ./start.sh up >"$WORK/legacy-update.log" 2>&1 && wait_healthy kbmig-legacy-webapp && wait_http "$LEG_URL"; then
    metric "B.update_s" "$(since "$t0")"
    pass "B: git pull + ./start.sh up onto $NEW_TAG ($(git -C "$LEG" log --oneline -1 | cut -c1-60))"
  else
    fail "B: the update"; tail -20 "$WORK/legacy-update.log" | sed 's/^/     /'
  fi
  check "B: the updated webapp has the kinboard command" docker exec kbmig-legacy-webapp sh -c 'command -v kinboard'
  TOKEN="$(make_token "$LEG_URL" "$STATE/device-legacy-chromium-1.json" "$LFAM")"
  check "B: an integration token made before the move answers" token_ok "$LEG_URL" "${TOKEN:-none}"
  snapshot kbmig-legacy-db legacy-before
  files_in_folder "$LEG_DATA/storage/files" >"$WORK/legacy.files"
  LEG_SECRETS="$(env_secrets "$LEG_DOCKER/.env")"

  say "B: export, a new all-in-one, import"
  t0=$(now)
  ( umask 077; docker exec kbmig-legacy-webapp kinboard export - >"$LEGACY_ARCHIVE" 2>"$WORK/export-legacy.log" )
  check "B: kinboard export ($(tail -n2 "$WORK/export-legacy.log" | head -n1 | sed 's/^\[kinboard\] //'))" bash -c "tar -tzf '$LEGACY_ARCHIVE' | grep -qx manifest.json"
  metric "B.export_s" "$(since "$t0")"; metric "B.archive_bytes" "$(stat -c %s "$LEGACY_ARCHIVE")"
  check "B: the archive carries no database password" bash -c "! tar -tzf '$LEGACY_ARCHIVE' | grep -q postgres_password"
  t0=$(now); aio_run kbmig-aio-b "$P_AIO" "$WORK/aio-b"
  if wait_healthy kbmig-aio-b; then
    metric "B.aio_first_start_s" "$(since "$t0")"
    IMPORT_AT=$(date +%s); t0=$(now)
    docker exec -i kbmig-aio-b kinboard import - <"$LEGACY_ARCHIVE" >"$WORK/import-b.log" 2>&1
    check "B: kinboard import ($(grep -m1 imported "$WORK/import-b.log" | sed 's/^\[kinboard\] //' | cut -c1-140))" grep -q 'count and checksum verified' "$WORK/import-b.log"
    metric "B.import_s" "$(since "$t0")"
    sleep 5; wait_http "http://127.0.0.1:$P_AIO" || fail "B: not answering after the import's restart"
    verify_aio "B legacy->aio" legacy-before "$WORK/legacy.files" "$LEG_SECRETS" kbmig-aio-b
    check "B: the integration token made before the move answers on the all-in-one" token_ok "http://127.0.0.1:$P_AIO" "${TOKEN:-none}"
    check "B: the demo family's join code (DEMO01) works on the all-in-one" join_ok "http://127.0.0.1:$P_AIO" DEMO01 b-demo
    # The devices signed in on the old install, opened with their cookies.
    if pw verify "http://127.0.0.1:$P_AIO" legacy desktop webkit -- KBMIG_DEVICES_FROM=chromium KBMIG_EXPECT_SESSIONS=kept; then
      pass "B: devices signed in before the move are still signed in; data, join code, PIN and live updates (Chromium, WebKit)"
    else
      fail "B: after the move (sessions: $(cat "$STATE"/sessions-legacy-*.json 2>/dev/null | tr '\n' ' '))"
    fi
    check "B: every page without a console error (Chromium, WebKit)" pw smoke "http://127.0.0.1:$P_AIO" legacy desktop webkit
    for f in "$STATE"/smoke-legacy-*.json; do [ -f "$f" ] && metric "B.$(basename "$f" .json)" "$(tr -d '\n' <"$f")"; done
    check "B: the server never failed to write its cache (EACCES on /app/.next)" bash -c "! docker logs kbmig-aio-b 2>&1 | grep -q 'EACCES.*/app/.next'"
    sum0="$(checksums kbmig-aio-b | grep -vE "$VOLATILE")"
    docker restart -t 60 kbmig-aio-b >/dev/null; wait_healthy kbmig-aio-b && wait_http "http://127.0.0.1:$P_AIO"
    check "B: after a restart of the all-in-one, every table as before" test "$sum0" = "$(checksums kbmig-aio-b | grep -vE "$VOLATILE")"
  else
    fail "B: the all-in-one never came up"; docker logs kbmig-aio-b 2>&1 | tail -20 | sed 's/^/     /'
  fi

  say "B: the old install, the household's way back"
  leg docker compose stop >/dev/null 2>&1
  if leg ./start.sh up >"$WORK/legacy-again.log" 2>&1 && wait_healthy kbmig-legacy-webapp && wait_http "$LEG_URL"; then
    check "B: the source is unchanged after the export and a restart" diff <(grep -vE "$VOLATILE" "$WORK/legacy-before.sums") <(checksums kbmig-legacy-db | grep -vE "$VOLATILE")
    check "B: on the source, its devices still signed in, data and live updates" \
      pw verify "$LEG_URL" legacy desktop -- KBMIG_DEVICES_FROM=chromium KBMIG_EXPECT_SESSIONS=kept
  else
    fail "B: the source did not start again"
  fi
fi
docker rm -f kbmig-aio-b >/dev/null 2>&1

# ================================================================== C: onefile

if want onefile; then
  say "C: a one-file compose.yml install -> all-in-one -> compose.yml"
  ONE_URL="http://127.0.0.1:$P_ONE"
  if one_up kbmig-one "$P_ONE" && wait_http "$ONE_URL"; then
    pass "C: compose.yml up (supabase/postgres 15)"
    check "C: onboarding in the browser" pw onboard "$ONE_URL" one desktop
    OFAM="$(fam_of one id)"
    fill_files "$ONE_URL" "$STATE/device-one-chromium-1.json" "$OFAM" kbmig-one-webapp /var/lib/storage/files nextjs:nodejs
    fill_tables kbmig-one-db
    OTOKEN="$(make_token "$ONE_URL" "$STATE/device-one-chromium-1.json" "$OFAM")"
    files_in_volume kbmig-one-storage >"$WORK/one.files"
    ONE_SECRETS="$(volume_secrets kbmig-one-config)"
    snapshot kbmig-one-db one-before
    ( umask 077; docker exec kbmig-one-webapp kinboard export - >"$WORK/one.tar.gz" 2>"$WORK/export-one.log" )
    check "C: kinboard export ($(tail -n2 "$WORK/export-one.log" | head -n1 | sed 's/^\[kinboard\] //'))" bash -c "tar -tzf '$WORK/one.tar.gz' | grep -qx manifest.json"
    aio_run kbmig-aio-c "$P_AIO" "$WORK/aio-c"
    if wait_healthy kbmig-aio-c; then
      IMPORT_AT=$(date +%s); t0=$(now)
      docker exec -i kbmig-aio-c kinboard import - <"$WORK/one.tar.gz" >"$WORK/import-c.log" 2>&1
      check "C: kinboard import into the all-in-one" grep -q 'count and checksum verified' "$WORK/import-c.log"
      metric "C.import_s" "$(since "$t0")"
      sleep 5; wait_http "http://127.0.0.1:$P_AIO"
      verify_aio "C one->aio" one-before "$WORK/one.files" "$ONE_SECRETS" kbmig-aio-c
      check "C: the integration token made before the move answers" token_ok "http://127.0.0.1:$P_AIO" "${OTOKEN:-none}"
      check "C: devices still signed in, data, join code, PIN, live updates (Chromium, WebKit)" \
        pw verify "http://127.0.0.1:$P_AIO" one desktop webkit -- KBMIG_DEVICES_FROM=chromium KBMIG_EXPECT_SESSIONS=kept
      check "C: every page without a console error (Chromium, WebKit)" pw smoke "http://127.0.0.1:$P_AIO" one desktop webkit

      say "C: back, all-in-one -> a fresh compose.yml install"
      snapshot kbmig-aio-c aio-c-before
      files_in_container kbmig-aio-c /data/storage/files >"$WORK/c-aio.files"
      ( umask 077; docker exec kbmig-aio-c kinboard export - >"$WORK/back.tar.gz" 2>/dev/null )
      ONE2_URL="http://127.0.0.1:$P_ONE2"
      if one_up kbmig-one2 "$P_ONE2"; then
        # The wiki's recipe: compose.yml's webapp mounts the config read-only.
        docker run --rm -i --network kbmig-one2_kinboard -e POSTGRES_HOST=db -e FILES_DIR=/var/lib/storage/files \
          -v kbmig-one2-config:/kinboard -v kbmig-one2-storage:/var/lib/storage "$RIG_IMAGE" kinboard import - \
          <"$WORK/back.tar.gz" >"$WORK/import-c2.log" 2>&1
        check "C: kinboard import into the fresh compose.yml install" grep -q 'count and checksum verified' "$WORK/import-c2.log"
        one_compose kbmig-one2 "$P_ONE2" restart rest webapp >/dev/null 2>&1
        wait_healthy kbmig-one2-webapp && wait_http "$ONE2_URL"
        same_tables "C aio->one" aio-c-before kbmig-one2-db
        same_files "C aio->one" "$WORK/c-aio.files" <(files_in_volume kbmig-one2-storage)
        check "C: the secrets back in the compose install's config" diff <(echo "$ONE_SECRETS") <(volume_secrets kbmig-one2-config)
        check "C: the files belong to the compose webapp's user" test -z "$(docker exec kbmig-one2-webapp find /var/lib/storage/files ! -user nextjs -print -quit)"
        check "C: the integration token answers on compose.yml again" token_ok "$ONE2_URL" "${OTOKEN:-none}"
        check "C: on compose.yml again, devices signed in, data, join code, live updates" \
          pw verify "$ONE2_URL" one desktop -- KBMIG_DEVICES_FROM=chromium KBMIG_EXPECT_SESSIONS=kept
      else
        fail "C: the second compose.yml stack"; tail -10 "$WORK/kbmig-one2.up.log" | sed 's/^/     /'
      fi
    else
      fail "C: the all-in-one never came up"
    fi
  else
    fail "C: the compose.yml stack"; tail -20 "$WORK/kbmig-one.up.log" | sed 's/^/     /'
  fi
  one_compose kbmig-one "$P_ONE" down -v >/dev/null 2>&1; one_compose kbmig-one2 "$P_ONE2" down -v >/dev/null 2>&1
  docker rm -f kbmig-aio-c >/dev/null 2>&1
fi

# =================================================================== D: errors

# refused_cleanly <container> <label> <secrets before>: still a fresh install
refused_cleanly() {
  local c="$1" l="$2" before="$3"
  check "$l: still no family" test "$(sql "$c" -c 'SELECT count(*) FROM families')" = 0
  check "$l: no file left in the files folder" test -z "$(docker exec "$c" find /data/storage/files -mindepth 1 -print -quit)"
  check "$l: the secrets as before, no record left" bash -c "[ \"\$(docker exec $c sh -c 'cd /data/config/secrets && sha256sum \$(ls | grep -v \"^\\.\" | sort)')\" = \"$before\" ] && ! docker exec $c test -e /data/config/secrets/.kinboard-import-pending.json"
}
# expect_refusal <container> <label> <archive> <pattern of the message>
expect_refusal() {
  local c="$1" l="$2" a="$3" pat="$4" out rc before
  before="$(secrets_hash "$c")"
  out="$(docker exec -i "$c" kinboard import --no-restart - <"$a" 2>&1)"; rc=$?
  check "D: $l refused (exit $rc): $(head -n3 <<<"$out" | tr '\n' ' ' | cut -c1-220)" bash -c "[ $rc != 0 ] && grep -qE -- \"\$1\" <<<\"\$2\"" _ "$pat" "$out"
  refused_cleanly "$c" "D: $l" "$before"
}
# make_archive <out> <python body using t (TarFile) and src (folder of the real archive)>
make_archive() { python3 -I - "$WORK/x" "$1" "$2" <<'PY'
import io, json, os, sys, tarfile
src, out, body = sys.argv[1], sys.argv[2], sys.argv[3]
os.chdir(src)
with tarfile.open(out, "w:gz") as t:
    exec(body)
PY
}

if want errors && [ "$B_UP" = 1 ] && [ -s "$LEGACY_ARCHIVE" ]; then
  say "D: what an import must refuse, leaving a fresh install"
  ERR=kbmig-err; ERR_URL="http://127.0.0.1:$P_ERR"
  aio_run "$ERR" "$P_ERR" "$WORK/err"
  if wait_healthy "$ERR"; then
    rm -rf "$WORK/x"; mkdir -p "$WORK/x"; tar -xzf "$LEGACY_ARCHIVE" -C "$WORK/x"
    head -c "$(( $(stat -c %s "$LEGACY_ARCHIVE") / 2 ))" "$LEGACY_ARCHIVE" >"$WORK/truncated.tar.gz"
    head -c 200000 /dev/urandom >"$WORK/random.tar.gz"; : >"$WORK/empty.tar.gz"
    cp "$WORK/on-legacy.tar.gz" "$WORK/docker-error.tar.gz"
    expect_refusal "$ERR" "a truncated archive" "$WORK/truncated.tar.gz" 'not a readable archive'
    expect_refusal "$ERR" "random bytes" "$WORK/random.tar.gz" 'not a readable archive'
    expect_refusal "$ERR" "an empty archive" "$WORK/empty.tar.gz" 'not a readable archive'
    expect_refusal "$ERR" "the file a failed docker exec wrote (the error text, not an archive)" "$WORK/docker-error.tar.gz" 'not a readable archive'
    make_archive "$WORK/sum.tar.gz" 'm = json.load(open("manifest.json")); m["tables"][3]["checksum"] = "0" * 32
open("m2", "w").write(json.dumps(m)); t.add("m2", arcname="manifest.json")
for n in ("data", "secrets", "files"): t.add(n)'
    expect_refusal "$ERR" "a table whose checksum was changed" "$WORK/sum.tar.gz" 'rolled back'
    make_archive "$WORK/file.tar.gz" 'm = json.load(open("manifest.json")); f = m["files"][0]["path"]
t.add("manifest.json"); t.add("data"); t.add("secrets")
for root, _, names in os.walk("files"):
    for n in names:
        p = os.path.join(root, n); b = open(p, "rb").read()
        if p == "files/" + f: b += b"X"
        i = t.gettarinfo(p); i.size = len(b); t.addfile(i, io.BytesIO(b))'
    expect_refusal "$ERR" "a file changed after the export" "$WORK/file.tar.gz" 'differs from what the archive'
    make_archive "$WORK/climb.tar.gz" 't.add("manifest.json"); b = b"owned"; i = tarfile.TarInfo("files/../../escaped"); i.size = len(b); t.addfile(i, io.BytesIO(b))'
    expect_refusal "$ERR" "a path climbing out of the archive" "$WORK/climb.tar.gz" 'refusing this archive'
    make_archive "$WORK/abs.tar.gz" 't.add("manifest.json"); b = b"owned"; i = tarfile.TarInfo("/data/config/secrets/jwt_secret"); i.size = len(b); t.addfile(i, io.BytesIO(b))'
    expect_refusal "$ERR" "an absolute path (busybox tar unpacks it inside its folder)" "$WORK/abs.tar.gz" 'refusing this archive|is missing from the archive'
    make_archive "$WORK/symlink.tar.gz" 't.add("manifest.json"); i = tarfile.TarInfo("files/recipe-images/x.jpg"); i.type = tarfile.SYMTYPE; i.linkname = "/data/config/secrets/postgres_password"; t.addfile(i)'
    expect_refusal "$ERR" "a symlink" "$WORK/symlink.tar.gz" 'refusing this archive'
    make_archive "$WORK/hardlink.tar.gz" 't.add("manifest.json"); i = tarfile.TarInfo("files/passwd"); i.type = tarfile.LNKTYPE; i.linkname = "etc/passwd"; t.addfile(i)'
    expect_refusal "$ERR" "a hard link" "$WORK/hardlink.tar.gz" 'refusing this archive'

    say "D: another version, both ways"
    # A later release: the same image with one migration more.
    mkdir -p "$WORK/newer-ctx"
    printf 'FROM %s\nLABEL %s\nUSER root\nRUN printf "%%s\\n" "-- a later release (test-migration-aio.sh)" "CREATE TABLE IF NOT EXISTS public.kbmig_newer (id int PRIMARY KEY);" >/app/migrations/999_kbmig_newer.sql\n' \
      "$AIO_IMAGE" "$LABEL" >"$WORK/newer-ctx/Dockerfile"
    if "${SLOT[@]}" docker build -q -t kbmig-rig-newer:"$rev" "$WORK/newer-ctx" >/dev/null; then
      BUILT+=("kbmig-rig-newer:$rev")
      aio_run kbmig-newer "$P_NEW" "$WORK/newer" --image "kbmig-rig-newer:$rev"
      if wait_healthy kbmig-newer; then
        expect_refusal kbmig-newer "an archive from an older version into a newer install" "$LEGACY_ARCHIVE" 'another version'
        ( umask 077; docker exec kbmig-newer kinboard export - >"$WORK/newer.tar.gz" 2>/dev/null )
        expect_refusal "$ERR" "an archive from a newer version into an older install" "$WORK/newer.tar.gz" 'another version'
      else fail "D: the newer image never came up"; fi
      docker rm -f kbmig-newer >/dev/null 2>&1
    else
      fail "D: could not build the newer image"
    fi

    say "D: into an install that already has a family"
    docker exec -i "$ERR" kinboard import - <"$LEGACY_ARCHIVE" >"$WORK/err-first.log" 2>&1
    sleep 5; wait_http "$ERR_URL"
    sum0="$(checksums "$ERR")"; f0="$(files_in_container "$ERR" /data/storage/files)"; s0="$(secrets_hash "$ERR")"
    out="$(docker exec -i "$ERR" kinboard import - <"$LEGACY_ARCHIVE" 2>&1)"
    check "D: a second import is refused: $(echo "$out" | tail -n1 | cut -c1-160)" grep -q 'already has' <<<"$out"
    check "D: ... every table, file and secret as before" bash -c "[ \"\$1\" = \"\$(docker exec -i $ERR psql -X -q -U supabase_admin -d postgres -tA <'$HERE/table-checksums.sql')\" ] && [ \"\$2\" = \"\$3\" ]" _ "$sum0" "$f0" "$(files_in_container "$ERR" /data/storage/files)"
    check "D: ... the secrets as before" test "$s0" = "$(secrets_hash "$ERR")"
  else
    fail "D: the target never came up"
  fi
  docker rm -f "$ERR" >/dev/null 2>&1

  # ---- the import cut off: SIGKILL at three points, start again, import again
  say "D: the container killed during an import"
  # Big enough that each stage lasts a moment: rows and photos added to the source.
  docker exec -u 0 kbmig-legacy-webapp sh -c "d=/var/lib/storage/files/family-photos/bulk; mkdir -p \$d; i=0; while [ \$i -lt $RIG_BULK_MB ]; do i=\$((i + 1)); head -c 1048576 /dev/urandom >\$d/p\$i.jpg; done; chown -R nextjs:nodejs \$d"
  sql kbmig-legacy-db -c "SET session_replication_role = replica; INSERT INTO notification_logs (family_id, notification_type, title, body, data, status) SELECT (SELECT id FROM families WHERE join_code = 'DEMO01'), 'bulk', 'Bulk ' || g, repeat(md5(g::text), 8), jsonb_build_object('n', g), 'sent' FROM generate_series(1, $RIG_BULK_ROWS) g" >/dev/null
  BIG="$WORK/big.tar.gz"
  checksums kbmig-legacy-db | grep -vE "$VOLATILE" >"$WORK/big.sums"
  t0=$(now); ( umask 077; docker exec kbmig-legacy-webapp kinboard export - >"$BIG" 2>/dev/null )
  metric "D.big_export_s" "$(since "$t0")"; metric "D.big_archive_bytes" "$(stat -c %s "$BIG")"
  metric "D.big_rows" "$(tar -xzOf "$BIG" manifest.json | jq '[.tables[].rows] | add')"
  for stage in files secrets db; do
    K="kbmig-kill-$stage"
    aio_run "$K" "$P_KILL" "$WORK/$K"
    wait_healthy "$K" || { fail "D/kill $stage: never came up"; continue; }
    before="$(secrets_hash "$K")"
    docker cp "$HERE/stop-import-at.sh" "$K:/tmp/stop-import-at.sh" >/dev/null
    ( docker exec -i "$K" kinboard import - <"$BIG" >"$WORK/$K.log" 2>&1 ) &
    imp=$!
    if docker exec "$K" sh /tmp/stop-import-at.sh "$stage" >"$WORK/$K.stop" 2>&1; then
      docker kill "$K" >/dev/null; wait "$imp" 2>/dev/null
      pass "D/kill $stage: SIGKILLed with the import at '$stage'"
      leftover="$(docker run --rm -v "$WORK/$K:/d" alpine:3 sh -c 'echo "record=$(test -e /d/config/secrets/.kinboard-import-pending.json && echo yes || echo no) files=$(find /d/storage/files -type f | wc -l)"')"
      step "on disk after the kill: $leftover"
      docker start "$K" >/dev/null
      if wait_healthy "$K"; then
        check "D/kill $stage: after the restart no family is visible (setup status: $(curl -s "http://127.0.0.1:$P_KILL/api/setup/status"))" \
          bash -c "curl -s http://127.0.0.1:$P_KILL/api/setup/status | jq -e '.hasFamilies == false' >/dev/null"
        check "D/kill $stage: after the restart, the install runs on its own secrets again (none of the archive's)" test "$before" = "$(secrets_hash "$K")"
        check "D/kill $stage: after the restart, none of the archive's files are left in /data/storage/files" \
          test -z "$(docker exec "$K" find /data/storage/files -type f -print -quit)"
        t0=$(now)
        docker exec -i "$K" kinboard import - <"$BIG" >"$WORK/$K.again.log" 2>&1
        check "D/kill $stage: importing again succeeds ($(grep -m1 -E 'cut off|imported' "$WORK/$K.again.log" | sed 's/^\[kinboard\] //' | cut -c1-120))" grep -q 'count and checksum verified' "$WORK/$K.again.log"
        metric "D.kill_$stage.reimport_s" "$(since "$t0")"
        sleep 5; wait_http "http://127.0.0.1:$P_KILL"
        check "D/kill $stage: then every table as on the source" diff "$WORK/big.sums" <(checksums "$K" | grep -vE "$VOLATILE")
      else
        fail "D/kill $stage: did not start again after the kill"; docker logs "$K" 2>&1 | tail -15 | sed 's/^/     /'
      fi
    else
      fail "D/kill $stage: the import never reached '$stage' ($(cat "$WORK/$K.stop"))"; wait "$imp" 2>/dev/null
    fi
    docker rm -f "$K" >/dev/null 2>&1
  done

  # ---- /data full: during the files, during the database; then room is made
  say "D: /data fills up during an import"
  if sudo -n true 2>/dev/null; then
    big_files_mb=$(( $(tar -xzOf "$BIG" manifest.json | jq '[.files[].size] | add') / 1048576 ))
    for where in files db; do
      F="kbmig-full-$where"; img="$WORK/$F.img"; mnt="$WORK/$F"
      # Room for a fresh install (about 60 MB) and: half the files, or the files and half the database.
      size=$(( 110 + big_files_mb / 2 )); [ "$where" = db ] && size=$(( 160 + big_files_mb ))
      truncate -s "${size}M" "$img" && mkfs.ext4 -q -F "$img" && mkdir -p "$mnt" && sudo -n mount -o loop "$img" "$mnt" && sudo -n chown 1000:1000 "$mnt" && LOOPS+=("$mnt")
      aio_run "$F" "$P_FULL" "$mnt"
      wait_healthy "$F" || { fail "D/full $where: never came up on a ${size} MB disk"; docker logs "$F" 2>&1 | tail -10; docker rm -f "$F" >/dev/null; continue; }
      before="$(secrets_hash "$F")"
      out="$(docker exec -i "$F" kinboard import - <"$BIG" 2>&1)"; rc=$?
      check "D/full $where: the import fails (exit $rc) and says so: $(tr '\n' ' ' <<<"$out" | cut -c1-200)" test "$rc" != 0
      check "D/full $where: the message says what to do (free space, how much)" grep -qiE 'free|space.*(MB|GB)' <<<"$out"
      sleep 5
      check "D/full $where: the container still healthy" wait_healthy "$F" 60
      refused_cleanly "$F" "D/full $where" "$before"
      # Room made: the disk grown online, the same import again.
      truncate -s "$(( size + big_files_mb * 3 + 600 ))M" "$img" && sudo -n losetup -c "$(losetup -j "$img" | cut -d: -f1)" && sudo -n resize2fs -f "$(losetup -j "$img" | cut -d: -f1)" >/dev/null 2>&1
      docker exec -i "$F" kinboard import - <"$BIG" >"$WORK/$F.again.log" 2>&1
      check "D/full $where: with room made, the same import succeeds" grep -q 'count and checksum verified' "$WORK/$F.again.log"
      docker rm -f "$F" >/dev/null 2>&1; sudo -n umount "$mnt"; rm -f "$img"
    done
  else
    fail "D/full: skipped, needs sudo to mount a small filesystem (run where sudo -n works)"
  fi

  # ---- the image pointed at a compose install's database folder (a copy)
  say "D: the all-in-one pointed at a compose install's data folder"
  OLD="$WORK/old-compose-data"
  leg docker compose stop db >/dev/null 2>&1
  docker run --rm -v "$LEG_DATA:/from:ro" -v "$WORK:/w" alpine:3 sh -c 'mkdir -p /w/old-compose-data && cp -a /from/db /from/storage /w/old-compose-data/'
  leg docker compose start db >/dev/null 2>&1
  own_before="$(docker run --rm -v "$OLD:/d:ro" alpine:3 sh -c 'find /d -exec stat -c "%u:%g %a %s %n" {} + | sort | md5sum')"
  docker run -d --name kbmig-old --label "$LABEL" -v "$OLD:/data" "$AIO_IMAGE" >/dev/null
  if wait_exit kbmig-old 120; then
    log_old="$(docker logs kbmig-old 2>&1)"
    check "D/old folder: refused, and the log says why and what to do ($(grep -m1 -E 'REFUSED|refus' <<<"$log_old" | cut -c1-160))" \
      grep -q "cluster that this image did not create" <<<"$log_old"
    check "D/old folder: nothing in the folder changed (owners, modes, sizes)" \
      test "$own_before" = "$(docker run --rm -v "$OLD:/d:ro" alpine:3 sh -c 'find /d -exec stat -c "%u:%g %a %s %n" {} + | sort | md5sum')"
    docker rm -f kbmig-old >/dev/null
    # And the compose install's PostgreSQL still opens that folder.
    docker run -d --name kbmig-old-pg --label "$LABEL" -e POSTGRES_PASSWORD=x -v "$OLD/db:/var/lib/postgresql/data" \
      "$(docker inspect -f '{{.Config.Image}}' kbmig-legacy-db)" >/dev/null
    ok=0; for i in $(seq 1 30); do docker exec kbmig-old-pg pg_isready -q -U postgres 2>/dev/null && { ok=1; break; }; sleep 2; done
    check "D/old folder: supabase/postgres still starts on it afterwards" test "$ok" = 1
    [ "$ok" = 1 ] || docker logs kbmig-old-pg 2>&1 | tail -5 | sed 's/^/     /'
    docker rm -f kbmig-old-pg >/dev/null
  else
    fail "D/old folder: the container did not stop"; docker rm -f kbmig-old >/dev/null
  fi

  # ---- a /data owned by another uid than PUID (a NAS share)
  say "D: /data owned by another user than PUID"
  NAS="$WORK/nas"
  docker run --rm -v "$WORK:/w" alpine:3 sh -c 'mkdir -p /w/nas/other && echo x >/w/nas/other/a && chown -R 1234:1234 /w/nas'
  aio_run kbmig-puid "$P_PUID" "$NAS"
  if wait_healthy kbmig-puid; then
    check "D/puid: the log says /data belonged to 1234:1234 and how to keep that owner (PUID/PGID)" \
      bash -c "docker logs kbmig-puid 2>&1 | grep -E '1234:1234' | grep -qE 'PUID'"
    check "D/puid: files of the folder's owner that are not Kinboard's are left alone" \
      test "$(docker run --rm -v "$NAS:/d:ro" alpine:3 stat -c %u:%g /d/other/a)" = 1234:1234
  else
    fail "D/puid: never came up"
  fi
  docker rm -f kbmig-puid >/dev/null 2>&1
fi

# ===================================================================== E: docs

if want docs; then
  say "E: the wiki's move, as written"
  DOCS="${RIG_DOCS_DIR:-$REPO_ROOT/docs/wiki}"
  DOC="$DOCS/All-in-one.md"
  # Fenced bash blocks of one section, one command per line (continuations joined, comments dropped).
  section() { awk -v h="$1" '$0 == h {f = 1; next} /^## /{f = 0} f' "$DOC"; }
  blocks() { awk '/^ *```bash$/{f = 1; n++; next} /^ *```$/{f = 0} f {print n "\t" $0}'; }
  cmds_of() { awk -F'\t' -v n="$1" '$1 == n {sub(/^[^\t]*\t */, ""); print}' | sed -e :a -e '/\\$/N; s/\\\n[[:space:]]*/ /; ta' | grep -vE '^\s*(#|$)'; }
  MOVE="$(section '## Moving between the compose file and the all-in-one image' | blocks)"
  run_cmd="$(section '## Start it' | blocks | cmds_of 1)"
  to_n="$(awk -F'\t' '/docker exec -i kinboard kinboard import/ {print $1; exit}' <<<"$MOVE")"
  back_n="$(awk -F'\t' '/docker run --rm -i/ {print $1; exit}' <<<"$MOVE")"
  to_aio="$(cmds_of "$to_n" <<<"$MOVE")"; back="$(cmds_of "$back_n" <<<"$MOVE")"
  check "E: the wiki has the docker run, the move to the all-in-one image and the way back" bash -c "[ -n \"\$1\" ] && [ -n \"\$2\" ] && [ -n \"\$3\" ]" _ "$run_cmd" "$to_aio" "$back"
  # Only names, ports, folders and image tags change; each is listed here.
  subst() {
    sed -e "s#--name kinboard #--name kbmig-docs #; s#docker exec -i kinboard #docker exec -i kbmig-docs #; s#docker exec kinboard #docker exec kbmig-docs #" \
        -e "s#kinboard-webapp#kbmig-docscmp-webapp#g; s#kinboard-db\b#kbmig-docscmp2-db#g; s#-p 3001:3000#-p 127.0.0.1:$P_DOCS:3000#; s#/srv/kinboard:/data#$WORK/docs-data:/data#" \
        -e "s#kinboard_kinboard#kbmig-docscmp2_kinboard#g; s#-v kinboard-config:#-v kbmig-docscmp2-config:#; s#-v kinboard-storage:#-v kbmig-docscmp2-storage:#" \
        -e "s#ghcr.io/svenger87/kinboard-aio:[a-z0-9.-]*#$AIO_IMAGE#; s#ghcr.io/svenger87/kinboard:<the same version>#$RIG_IMAGE#; s#ghcr.io/svenger87/kinboard:next#$RIG_IMAGE#" \
        -e "s#--restart unless-stopped ##" <<<"$1"
  }
  step "changed for the rig: kinboard / kinboard-webapp / kinboard-db -> kbmig-docs / kbmig-docscmp-webapp / kbmig-docscmp2-db, port 3001 -> $P_DOCS, /srv/kinboard -> a temp folder, the volumes and network -> kbmig-docscmp2-*, image tags -> the images under test, no --restart"
  doc_tag="$(grep -oE 'ghcr.io/svenger87/kinboard-aio:[a-z0-9.-]+' <<<"$run_cmd" | head -1)"
  check "E: the image the wiki names can be pulled ($doc_tag)" docker manifest inspect "$doc_tag"
  if one_up kbmig-docscmp "$P_DOCSCMP"; then
    docker exec -i kbmig-docscmp-db psql -X -q -U postgres -d postgres <"$SEED_SQL" >/dev/null 2>&1
    mkdir -p "$WORK/docs-cwd" "$WORK/docs-data"; cd "$WORK/docs-cwd" || exit 1
    while IFS= read -r c; do
      if grep -q 'kinboard import' <<<"$c"; then
        bash -c "$(subst "$run_cmd")" >/dev/null
        wait_healthy kbmig-docs || { fail "E: the wiki's docker run never became healthy"; break; }
      fi
      out="$(bash -c "$(subst "$c")" 2>&1)"; rc=$?
      check "E: '$(cut -c1-100 <<<"$c")' (exit $rc)" test "$rc" = 0
      [ $rc = 0 ] || sed 's/^/     /' <<<"$out" | tail -5
      if grep -q 'kinboard export' <<<"$c"; then
        check "E: the archive it writes is private (mode $(stat -c %a kinboard-export.tar.gz 2>/dev/null))" test "$(stat -c %a kinboard-export.tar.gz 2>/dev/null)" = 600
      fi
    done <<<"$to_aio"
    if wait_http "http://127.0.0.1:$P_DOCS"; then
      check "E: the demo family's code joins the all-in-one" join_ok "http://127.0.0.1:$P_DOCS" DEMO01 docs
    fi
    # Back: the block as one script (it sets NET for the next line), in the compose install's folder.
    if one_up kbmig-docscmp2 "$P_ONE2"; then
      cd "$WORK/kbmig-docscmp2" || exit 1
      out="$(env -i PATH="$PATH" HOME="$HOME" KINBOARD_IMAGE="${RIG_IMAGE%:*}" KINBOARD_TAG="${RIG_IMAGE##*:}" WEBAPP_PORT="$P_ONE2" \
             bash -ec "$(subst "$back")" 2>&1)"; rc=$?
      check "E: the way back, the wiki's block as written ($(wc -l <<<"$back") lines, exit $rc)" bash -c "[ $rc = 0 ] && grep -q 'count and checksum verified' <<<\"\$1\"" _ "$out"
      [ $rc = 0 ] || tail -5 <<<"$out" | sed 's/^/     /'
      wait_http "http://127.0.0.1:$P_ONE2" && check "E: the demo family's code joins the compose install again" join_ok "http://127.0.0.1:$P_ONE2" DEMO01 docs-back
    else
      fail "E: the second compose stack"
    fi
    cd "$REPO_ROOT" || true
  else
    fail "E: the compose stack the wiki's export starts from"
  fi
  check "E: Self-hosting.md does not call export/import 'planned' any more" bash -c "! grep -q 'kinboard import\` for this move is planned' '$DOCS/Self-hosting.md'"
  check "E: the wiki says how a git install gets onto the same version (KINBOARD_TAG)" bash -c "section() { awk -v h=\"\$1\" '\$0 == h {f = 1; next} /^## /{f = 0} f' '$DOC'; }; section '## Moving between the compose file and the all-in-one image' | grep -q KINBOARD_TAG"
  check "E: the wiki says to stop the old install once the new one runs" grep -qiE 'stop it|stop the old' "$DOC"
  one_compose kbmig-docscmp "$P_DOCSCMP" down -v >/dev/null 2>&1; one_compose kbmig-docscmp2 "$P_ONE2" down -v >/dev/null 2>&1
  docker rm -f kbmig-docs >/dev/null 2>&1
fi

# ==================================================================== F: copy

# A copy of a real household's backup through the same move: the rehearsal
# on real data RFC-024 asks for before the all-in-one image gets `latest`.
#   RIG_COPY_DUMP   a pg_dumpall (.sql.gz) of a compose install's supabase/postgres 15
#   RIG_COPY_FILES  its uploaded files (.tar.gz with storage/files/...)
# Privacy: nothing of the data is printed (counts, checksums, timings and
# table names only; the browser's failure details are not shown), no
# connection leaves the copy's containers (blocked with iptables before the
# stacks start, and checked before the data goes in), and the copy runs on
# this rig's own secrets, so its device sessions cannot validate and its
# integrations' credentials are compared as rows, never used.
if want copy; then
  say "F: a copy of a household's backup (supabase/postgres 15 -> the all-in-one image's 17)"
  if [ -z "${RIG_COPY_DUMP:-}" ] || [ -z "${RIG_COPY_FILES:-}" ] || ! sudo -n true 2>/dev/null; then
    fail "F: needs RIG_COPY_DUMP, RIG_COPY_FILES and sudo (egress is blocked with iptables)"
  else
    [ "$B_UP" = 1 ] && { leg docker compose down -v --remove-orphans >/dev/null 2>&1; B_UP=0; }
    docker run --rm -v "$WORK:/w" alpine:3 sh -c 'rm -rf /w/kinboard /w/legacy-data' >/dev/null 2>&1
    COPY_SUBNET=10.225.0.0/24
    for sn in "$SUBNET" "$COPY_SUBNET"; do
      sudo -n iptables -I DOCKER-USER -s "$sn" ! -d "$sn" -j DROP
      sudo -n iptables -I DOCKER-USER -s "$sn" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
      IPT_RULES+=("$sn")
    done
    egress_blocked() {  # nothing outside answers, by address or by name
      ! docker exec "$1" sh -c 'curl -s -m 5 -o /dev/null https://1.1.1.1 || curl -s -m 5 -o /dev/null https://github.com || wget -q -T 5 -O /dev/null http://1.1.1.1' >/dev/null 2>&1
    }
    # 1. The dump as it was taken: a scratch supabase/postgres with no network.
    SUPA="$(sed -n 's/^    image: \(supabase\/postgres:[^ ]*\)$/\1/p' "$REPO_ROOT/compose.yml")"
    docker run -d --name kbmig-copy-src --label "$LABEL" --network none -e POSTGRES_PASSWORD=copy "$SUPA" >/dev/null
    # Its first start runs the init scripts on a temporary server, then
    # restarts: ready means after "init process complete", with the roles there.
    for i in $(seq 1 90); do
      docker logs kbmig-copy-src 2>&1 | grep -q 'PostgreSQL init process complete' \
        && sql kbmig-copy-src -c "SELECT 1 FROM pg_roles WHERE rolname = 'authenticator'" 2>/dev/null | grep -q 1 && break
      sleep 2
    done
    t0=$(now)
    # The roles' passwords stay out: the dump would set the household's
    # password hashes on this scratch server (and lock the rig out of it).
    gunzip -c "$RIG_COPY_DUMP" | sed -E "s/ PASSWORD '[^']*'//" \
      | docker exec -i kbmig-copy-src psql -X -q -U supabase_admin -d postgres >/dev/null 2>"$WORK/copy-restore.err"
    metric "F.dumpall_restore_s" "$(since "$t0")"
    metric "F.dumpall_restore_errors" "$(grep -c ERROR "$WORK/copy-restore.err") (roles and schemas the image already has)"
    docker exec kbmig-copy-src pg_dump -U supabase_admin -d postgres -Fc --data-only -n public >"$WORK/copy.pgdump"
    checksums kbmig-copy-src >"$WORK/copy-src.sums"
    src_n="$(checksums kbmig-copy-src | wc -l)"; src_rows="$(checksums kbmig-copy-src | awk '{s += $2} END {print s + 0}')"
    metric "F.source_tables" "$src_n"; metric "F.source_rows" "$src_rows"
    check "F: the backup restored on its own PostgreSQL 15 ($src_n tables, $src_rows rows)" bash -c "[ $src_n -gt 0 ] && [ $src_rows -gt 0 ] && [ -s '$WORK/copy.pgdump' ]"
    metric "F.source_postgres" "$(sql kbmig-copy-src -c 'SHOW server_version')"
    # 2. A git install of LEGACY_TAG, restored the documented way (Self-hosting → Restoring one).
    legacy_setup
    if [ "$B_UP" = 1 ]; then
      check "F: no connection leaves the old install's containers (checked before the data goes in)" egress_blocked kbmig-legacy-webapp
      sql kbmig-legacy-db -c "TRUNCATE public.instance_settings" >/dev/null
      docker exec -i kbmig-legacy-db pg_restore -U supabase_admin -d postgres --data-only --disable-triggers -n public <"$WORK/copy.pgdump" 2>"$WORK/copy-pgrestore.err"
      # public.schema_migrations is the migration record from before 1.15 (it
      # moved to kinboard.schema_migrations); an install that started on 1.15
      # or later never had the table, so its rows have nowhere to go.
      others="$(grep 'ERROR' "$WORK/copy-pgrestore.err" | grep -vc 'relation "public.schema_migrations" does not exist')"
      metric "F.pg_restore_errors" "$(grep -c 'ERROR' "$WORK/copy-pgrestore.err") (public.schema_migrations, the pre-1.15 record: $(grep -c 'public.schema_migrations' "$WORK/copy-pgrestore.err"))"
      check "F: the documented pg_restore into $LEGACY_TAG: no error but the pre-1.15 public.schema_migrations ($others others)" test "$others" = 0
      docker run --rm -v "$RIG_COPY_FILES:/a.tgz:ro" -v "$LEG_DATA:/d" alpine:3 tar -xzf /a.tgz -C /d
      diff <(grep -vE "$VOLATILE|^public\.schema_migrations " "$WORK/copy-src.sums") <(checksums kbmig-legacy-db | grep -vE "$VOLATILE") | awk '/^[<>]/ {print $2}' | sort -u >"$WORK/copy-restore.diff"
      check "F: the restored copy is the backup (every table by rows and checksum, $LEGACY_TAG against the dump${PIPESTATUS:+}; differing: $(tr '\n' ' ' <"$WORK/copy-restore.diff"))" test ! -s "$WORK/copy-restore.diff"
      docker rm -f kbmig-copy-src >/dev/null
      t0=$(now)
      ( cd "$LEG" && "${PULL[@]}" ) >/dev/null 2>&1; set_env KINBOARD_TAG "$NEW_TAG"
      leg ./start.sh up >"$WORK/copy-update.log" 2>&1 && wait_healthy kbmig-legacy-webapp && wait_http "$LEG_URL"
      check "F: updated the documented way (git pull, ./start.sh up), the migrations on real data: $(grep -oE 'done: [0-9]+ applied, [0-9]+ already' <(docker logs kbmig-legacy-webapp 2>&1) | tail -1)" \
        bash -c "docker logs kbmig-legacy-webapp 2>&1 | grep -qE 'done: [0-9]+ applied'"
      metric "F.update_s" "$(since "$t0")"
      check "F: still no connection out after the update" egress_blocked kbmig-legacy-webapp
      snapshot kbmig-legacy-db copy-before
      files_in_folder "$LEG_DATA/storage/files" >"$WORK/copy.files"
      t0=$(now)
      ( umask 077; docker exec kbmig-legacy-webapp kinboard export - >"$WORK/copy.tar.gz" 2>/dev/null )
      metric "F.export_s" "$(since "$t0")"; metric "F.archive_bytes" "$(stat -c %s "$WORK/copy.tar.gz")"
      # 3. The all-in-one image on a network of its own, blocked the same way.
      docker network create --subnet "$COPY_SUBNET" --label "$LABEL" kbmig-copy-net >/dev/null
      t0=$(now); aio_run kbmig-copy-aio "$P_AIO" "$WORK/copy-aio" --network kbmig-copy-net
      if wait_healthy kbmig-copy-aio; then
        check "F: no connection leaves the all-in-one container (before the import)" egress_blocked kbmig-copy-aio
        IMPORT_AT=$(date +%s); t0=$(now)
        docker exec -i kbmig-copy-aio kinboard import - <"$WORK/copy.tar.gz" >"$WORK/copy-import.log" 2>&1
        check "F: kinboard import (every table's count and checksum verified)" grep -q 'count and checksum verified' "$WORK/copy-import.log"
        metric "F.import_s" "$(since "$t0")"
        sleep 5; wait_http "http://127.0.0.1:$P_AIO"
        verify_aio "F copy->aio" copy-before "$WORK/copy.files" "$(env_secrets "$LEG_DOCKER/.env")" kbmig-copy-aio
        for t in integration_secrets oauth_credentials integration_tokens push_subscriptions device_sessions; do
          check "F: $t identical (the credentials travel as they are stored)" \
            test "$(grep "^public.$t " "$WORK/copy-before.sums")" = "$(checksums kbmig-copy-aio | grep "^public.$t ")"
        done
        metric "F.postgres" "$(sql kbmig-legacy-db -c 'SHOW server_version') -> $(sql kbmig-copy-aio -c 'SHOW server_version')"
        metric "F.differences_15_to_17" "$(diff <(grep -vE "$VOLATILE" "$WORK/copy-before.sums") <(checksums kbmig-copy-aio | grep -vE "$VOLATILE") | grep -c '^>') tables"
        # The browser, as a new screen of that household (claude-* name), on its join code.
        code="$(sql kbmig-copy-aio -c "SELECT join_code FROM families ORDER BY created_at LIMIT 1")"
        fam="$(sql kbmig-copy-aio -c "SELECT id FROM families ORDER BY created_at LIMIT 1")"
        jq -n --arg id "$fam" --arg code "$code" '{id: $id, code: $code, name: "copy"}' >"$STATE/family-copy.json"; chmod 600 "$STATE/family-copy.json"
        check "F: a new screen joins with the household's code; live updates between two screens (Chromium, WebKit)" \
          pw verify "http://127.0.0.1:$P_AIO" copy desktop webkit -- KBMIG_PIN= KBMIG_PRIVATE=1 KBMIG_EGRESS_BLOCKED=1 KBMIG_NO_GO2RTC=1
        check "F: every page without a console error (Chromium, WebKit)" pw smoke "http://127.0.0.1:$P_AIO" copy desktop webkit -- KBMIG_PIN= KBMIG_PRIVATE=1 KBMIG_EGRESS_BLOCKED=1 KBMIG_NO_GO2RTC=1
        for f in "$STATE"/smoke-copy-*.json; do [ -f "$f" ] && metric "F.$(basename "$f" .json)" "$(tr -d '\n' <"$f")"; done
        check "F: no connection out after the import and the scheduler's runs" egress_blocked kbmig-copy-aio
        sql kbmig-copy-aio -c "DELETE FROM devices WHERE name LIKE 'claude-mig-%'" >/dev/null 2>&1
      else
        fail "F: the all-in-one never came up"
      fi
      docker rm -f kbmig-copy-aio >/dev/null 2>&1; docker network rm kbmig-copy-net >/dev/null 2>&1
      rm -f "$WORK/copy.tar.gz" "$WORK/copy.pgdump"
    fi
  fi
fi
