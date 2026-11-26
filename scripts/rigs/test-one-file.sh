#!/usr/bin/env bash
# test-one-file.sh — install Kinboard from compose.yml alone, the way a
# household pastes it into a Compose UI, and prove it holds (RFC-023 §8.1,
# rehearsals A1 and A3, headless).
#
# The file is copied, alone, into an empty folder: no git checkout, no .env,
# no other file. Nothing from this checkout reaches the stack except that
# file and the image under test.
#
#   fresh     up from nothing: init and db-init exit 0, the rest runs and the
#             webapp is healthy; the seven secret files in the config volume
#             with 0750/0640 root:0; no secret in any `docker inspect`;
#             /api/health db:true; a family created and a second device
#             joined; push configured; the internal scheduler ran a job.
#             Then a restart, and down/up: secrets and data kept.
#   paste     Portainer's web editor: `docker compose -p <other> -f - up -d`
#             from an empty folder. The fixed volume names keep the data.
#   folders   the same with KINBOARD_DB_DIR, _STORAGE_DIR and _CONFIG_DIR set
#             to absolute host folders (the Unraid way): binds instead of
#             volumes, the same checks, nothing in any Docker volume.
#   upgrade   install with the previous published image, then Up with this
#             build on the same volumes: the database container stays, the
#             webapp is replaced, data, device and secrets kept.
#   guards    A3: the database folder on a FAT image and the config folder on
#             tmpfs are refused before a database container exists; a deleted
#             postgres_password on an existing cluster is refused and the
#             cluster is not touched.
#
# Usage:
#   KINBOARD_RIG=1 scripts/rigs/test-one-file.sh
#   RIG_IMAGE=<image:tag>   the image under test (default: built from this checkout)
#   FROM_TAG=<tag>          the published image to upgrade from (default: the
#                           newest release with a one-file install, else `main`)
#   RIG_COMPOSE=<file>      the compose file under test (default: compose.yml)
#   RIG_PHASES="fresh paste folders upgrade guards"   a subset, while iterating
#   RIG_STRICT=1            a guard that can't be rehearsed here fails the run
#                           instead of being skipped (default on CI)
#   KEEP_FAILED=1           leave a failed stack up to inspect
#
# Isolation. compose.yml fixes its container names (kinboard-db, …) and its
# volume names (kinboard-db, kinboard-storage, kinboard-config), on purpose
# (§4.6, §7): a second stack fails on the name before it can open the same
# data. A rig that renamed them would not be testing the file. So this rig
# refuses to start on a host where any of those names exists — a real
# one-file install, or another run of this rig — and removes only what it
# created. Its own: compose projects kbone and kbpaste, port 3051 (the file's
# only published TCP port), and Docker's own choice of subnet (the file pins
# none). 8555/udp, go2rtc's WebRTC port, is fixed in the file and must be
# free.
#
# It touches nothing in the checkout: no .env, no setup.sh, no skip-worktree
# flags. `git status` is compared before and after (#551).

set -uo pipefail

RIG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# A developer test, not an updater: nothing below runs unless asked for.
# shellcheck source=rig-intent.sh
. "$RIG_DIR/rig-intent.sh"
rig_require_intent "$@"; set -- "${RIG_ARGS[@]}"
REPO_ROOT="$(cd "$RIG_DIR/../.." && pwd)"

RIG_PROJECT="kbone"
PASTE_PROJECT="kbpaste"
RIG_WEBAPP_PORT=3051
BASE_URL="http://localhost:${RIG_WEBAPP_PORT}"
RIG_COMPOSE="${RIG_COMPOSE:-$REPO_ROOT/compose.yml}"
RIG_PHASES="${RIG_PHASES:-fresh paste folders upgrade guards}"
RIG_STRICT="${RIG_STRICT:-$([ -n "${CI:-}" ] && echo 1 || echo 0)}"
KEEP_FAILED="${KEEP_FAILED:-0}"
PUBLISHED="ghcr.io/svenger87/kinboard"

CONTAINERS=(kinboard-init kinboard-db kinboard-db-init kinboard-rest kinboard-webapp kinboard-go2rtc)
VOLUMES=(kinboard-db kinboard-storage kinboard-config)
SECRET_FILES=(cron_secret db_uri jwt_secret postgres_password presence_sensor_token vapid_private_key vapid_public_key)

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
step() { printf '   %s\n' "$*"; }
FAILURES=()
CHECKS=0
fail() { red "   FAIL: $*"; FAILURES+=("$*"); CHECKS=$((CHECKS + 1)); }
pass() { grn "   ok:   $*"; CHECKS=$((CHECKS + 1)); }
skip() { printf '\033[33m   SKIP: %s\033[0m\n' "$*"; SKIPPED+=("$*"); }
# A guard this host can't rehearse: skipped on a laptop, a failure on CI.
unrehearsed() { if [ "$RIG_STRICT" = "1" ]; then fail "$* (RIG_STRICT)"; else skip "$*"; fi; }
SKIPPED=()
want() { case " $RIG_PHASES " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

WORK=""
INSTALL=""
SCRATCH=""
BUILT_IMAGE=""
PULLED_FROM=""
FROM_IMAGE=""
FAT_MOUNT=""
SHM_DIR=""
GIT_BEFORE=""

# ------------------------------------------------------------------ compose

# The image under test, as the stack sees it: KINBOARD_IMAGE and KINBOARD_TAG
# from the process environment, never from a file.
IMAGE_REPO=""
IMAGE_TAG=""

# dc <dir> <project> [VAR=value ...] -- <compose args>: docker compose in that
# folder with an environment of nothing but PATH, HOME, the Docker endpoint
# and the variables given. A developer's own KINBOARD_TAG or TZ must not leak
# into a test of "no variables".
dc() {
  local dir="$1" project="$2"; shift 2
  local vars=()
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do vars+=("$1"); shift; done
  shift
  ( cd "$dir" && env -i PATH="$PATH" HOME="$HOME" ${DOCKER_HOST:+DOCKER_HOST="$DOCKER_HOST"} \
      ${DOCKER_CONFIG:+DOCKER_CONFIG="$DOCKER_CONFIG"} "${vars[@]}" \
      docker compose -p "$project" "$@" )
}
# The stack on the image under test, in the install folder.
up_test()  { dc "$INSTALL" "$RIG_PROJECT" KINBOARD_IMAGE="$IMAGE_REPO" KINBOARD_TAG="$IMAGE_TAG" WEBAPP_PORT="$RIG_WEBAPP_PORT" "$@" -- up -d; }
dc_test()  { dc "$INSTALL" "$RIG_PROJECT" KINBOARD_IMAGE="$IMAGE_REPO" KINBOARD_TAG="$IMAGE_TAG" WEBAPP_PORT="$RIG_WEBAPP_PORT" -- "$@"; }
dc_test_with() { local v=(); while [ "$1" != "--" ]; do v+=("$1"); shift; done; shift
  dc "$INSTALL" "$RIG_PROJECT" KINBOARD_IMAGE="$IMAGE_REPO" KINBOARD_TAG="$IMAGE_TAG" WEBAPP_PORT="$RIG_WEBAPP_PORT" "${v[@]}" -- "$@"; }

# What the stack left in Docker, whichever project made it.
remove_stack() {
  docker rm -f "${CONTAINERS[@]}" >/dev/null 2>&1 || true
  local p
  for p in "$RIG_PROJECT" "$PASTE_PROJECT"; do
    docker network rm "${p}_kinboard" >/dev/null 2>&1 || true
  done
}
remove_volumes() {
  docker volume rm "${VOLUMES[@]}" >/dev/null 2>&1 || true
}

# ------------------------------------------------------------------ cleanup

ARMED=0
on_exit() {
  local rc=$?
  trap - EXIT INT TERM
  if [ "$ARMED" = "1" ]; then
    if [ "$KEEP_FAILED" = "1" ] && [ ${#FAILURES[@]} -gt 0 ]; then
      red "KEEP_FAILED=1: the stack is left up at $BASE_URL"
      step "remove it with: docker rm -f ${CONTAINERS[*]}; docker volume rm ${VOLUMES[*]}; docker network rm ${RIG_PROJECT}_kinboard ${PASTE_PROJECT}_kinboard"
    else
      remove_stack
      remove_volumes
    fi
  fi
  if [ -n "$FAT_MOUNT" ] && mountpoint -q "$FAT_MOUNT" 2>/dev/null; then sudo -n umount "$FAT_MOUNT" >/dev/null 2>&1 || true; fi
  [ -n "$SHM_DIR" ] && docker run --rm -v "$(dirname "$SHM_DIR")":/t alpine:3 rm -rf "/t/$(basename "$SHM_DIR")" >/dev/null 2>&1
  [ -n "$SHM_DIR" ] && rm -rf "$SHM_DIR" 2>/dev/null
  if [ -n "$WORK" ] && [ -d "$WORK" ]; then
    rm -rf "$WORK" 2>/dev/null || docker run --rm -v "$WORK":/t alpine:3 sh -c 'rm -rf /t/* /t/.[!.]*' >/dev/null 2>&1
    rm -rf "$WORK" 2>/dev/null
  fi
  if [ -n "$BUILT_IMAGE" ] && [ "${RIG_KEEP_IMAGE:-0}" != "1" ]; then docker image rm "$BUILT_IMAGE" >/dev/null 2>&1 || true; fi
  if [ -n "$PULLED_FROM" ]; then docker image rm "$PULLED_FROM" >/dev/null 2>&1 || true; fi
  if [ -n "$GIT_BEFORE" ]; then
    if [ "$(git -C "$REPO_ROOT" status --porcelain=v1 --ignored 2>/dev/null)" = "$GIT_BEFORE" ]; then
      step "checkout as found (git status, ignored files included, unchanged)"
    else
      red "   the checkout changed during the run:"
      diff <(printf '%s\n' "$GIT_BEFORE") <(git -C "$REPO_ROOT" status --porcelain=v1 --ignored) | sed 's/^/     /'
      [ "$rc" = "0" ] && rc=1
    fi
  fi
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# --------------------------------------------------------------- preflight

say "Kinboard one-file rig (RFC-023 §8.1)"
[ -f "$RIG_COMPOSE" ] || { red "no compose file at $RIG_COMPOSE"; exit 1; }
for tool in docker curl jq sha256sum; do
  command -v "$tool" >/dev/null || { red "needs $tool"; exit 1; }
done

taken=()
for c in "${CONTAINERS[@]}"; do docker container inspect "$c" >/dev/null 2>&1 && taken+=("container $c"); done
for v in "${VOLUMES[@]}"; do docker volume inspect "$v" >/dev/null 2>&1 && taken+=("volume $v"); done
if [ ${#taken[@]} -gt 0 ]; then
  red "REFUSING: this host already has ${taken[*]}."
  red "compose.yml uses those fixed names on purpose, so this rig would share that install's data."
  red "Run the rig on a machine (or a CI runner) without a one-file Kinboard, or remove a leftover rig run:"
  red "  docker rm -f ${CONTAINERS[*]}; docker volume rm ${VOLUMES[*]}"
  exit 1
fi
if ss -lnt 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${RIG_WEBAPP_PORT}\$"; then
  red "port $RIG_WEBAPP_PORT is in use"; exit 1
fi
if ss -lnu 2>/dev/null | awk '{print $4}' | grep -qE "[:.]8555\$"; then
  red "udp port 8555 (go2rtc's WebRTC port, fixed in compose.yml) is in use"; exit 1
fi

GIT_BEFORE="$(git -C "$REPO_ROOT" status --porcelain=v1 --ignored 2>/dev/null)" || GIT_BEFORE=""
WORK="$(mktemp -d "${TMPDIR:-/tmp}/kinboard-one-file.XXXXXX")"
INSTALL="$WORK/install"
SCRATCH="$WORK/scratch"
mkdir -p "$INSTALL" "$WORK/paste" "$SCRATCH"
cp "$RIG_COMPOSE" "$INSTALL/compose.yml"
step "install folder: $INSTALL (compose.yml and nothing else)"

# The image under test.
if [ -n "${RIG_IMAGE:-}" ]; then
  docker image inspect "$RIG_IMAGE" >/dev/null 2>&1 || { red "no image $RIG_IMAGE"; exit 1; }
  step "image under test: $RIG_IMAGE"
else
  rev="$(git -C "$REPO_ROOT" rev-parse --short=7 HEAD)"
  BUILT_IMAGE="kinboard-one-file-rig:$rev"
  say "Building the image under test ($BUILT_IMAGE)"
  # Through the devbox's build slot when there is one (CLAUDE.md, "Heavy checks").
  slot=(); command -v kinboard-heavy-slot >/dev/null && slot=(kinboard-heavy-slot)
  if ! "${slot[@]}" docker build -q --build-arg BUILD_REVISION="$rev" -f "$REPO_ROOT/webapp/docker/Dockerfile" \
       -t "$BUILT_IMAGE" "$REPO_ROOT/webapp" >/dev/null; then
    red "build failed"; exit 1
  fi
  RIG_IMAGE="$BUILT_IMAGE"
fi
# A developer's .env.local must never reach the bundle (CLAUDE.md, 2026-08-06).
baked="$(docker run --rm --entrypoint sh "$RIG_IMAGE" -c 'grep -rlE "localhost:(8000|8130)" /app/.next/ 2>/dev/null | wc -l')"
if [ "$baked" != "0" ]; then
  red "$RIG_IMAGE has a localhost API address baked into $baked file(s) of its bundle; build it from a clean checkout"; exit 1
fi
IMAGE_REPO="${RIG_IMAGE%:*}"
IMAGE_TAG="${RIG_IMAGE##*:}"
[ "$IMAGE_REPO" != "$RIG_IMAGE" ] || { red "RIG_IMAGE needs a tag: $RIG_IMAGE"; exit 1; }
ARMED=1

# ------------------------------------------------------------------ helpers

# Waits for every long-running service to run and the webapp to be healthy.
wait_healthy() {
  local label="$1" budget="${2:-300}" i state
  for ((i = 0; i < budget; i += 5)); do
    state="$(docker inspect -f '{{.State.Health.Status}}' kinboard-webapp 2>/dev/null || true)"
    if [ "$state" = "healthy" ] && curl -sf -o /dev/null --max-time 3 "$BASE_URL/api/health"; then
      step "$label: webapp healthy after ${i}s"
      return 0
    fi
    sleep 5
  done
  fail "$label: the webapp was not healthy within ${budget}s (health: ${state:-none})"
  docker logs --tail 40 kinboard-webapp 2>&1 | sed 's/^/     /'
  return 1
}

exit_code() { docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$1" 2>/dev/null || echo "missing"; }

check_services() {
  local label="$1" s
  for s in kinboard-init kinboard-db-init; do
    [ "$(exit_code "$s")" = "exited 0" ] && pass "$label: $s exited 0" || fail "$label: $s is '$(exit_code "$s")', want 'exited 0'"
  done
  for s in kinboard-db kinboard-rest kinboard-webapp kinboard-go2rtc; do
    [ "$(docker inspect -f '{{.State.Status}}' "$s" 2>/dev/null)" = "running" ] \
      && pass "$label: $s running" || fail "$label: $s is not running"
  done
}

# One line per file in the config volume's secrets/: "name mode uid:gid sha256".
secrets_listing() {
  docker run --rm -v kinboard-config:/c:ro alpine:3 sh -c \
    'cd /c/secrets && for f in *; do printf "%s %s %s " "$f" "$(stat -c %a "$f")" "$(stat -c %u:%g "$f")"; sha256sum "$f" | cut -d" " -f1; done'
}
secrets_dir_mode() { docker run --rm -v kinboard-config:/c:ro alpine:3 stat -c '%a %u:%g' /c/secrets; }
secret_value() { docker run --rm -v kinboard-config:/c:ro alpine:3 cat "/c/secrets/$1"; }

check_secrets_store() {
  local label="$1" listing names modes
  listing="$(secrets_listing)"
  names="$(awk '{print $1}' <<<"$listing" | tr '\n' ' ' | sed 's/ $//')"
  [ "$names" = "${SECRET_FILES[*]}" ] && pass "$label: secrets/ holds exactly the seven files of §4.1" \
    || fail "$label: secrets/ holds '$names', want '${SECRET_FILES[*]}'"
  modes="$(awk '{print $2" "$3}' <<<"$listing" | sort -u | tr '\n' ';')"
  [ "$modes" = "640 0:0;" ] && pass "$label: every secret file 0640 root:0" || fail "$label: secret file modes '$modes', want '640 0:0'"
  [ "$(secrets_dir_mode)" = "750 0:0" ] && pass "$label: secrets/ is 0750 root:0" || fail "$label: secrets/ is '$(secrets_dir_mode)'"
}

# No secret value appears anywhere in any container's configuration.
check_inspect_clean() {
  local label="$1" f v leaks=() inspect
  inspect="$(docker inspect "${CONTAINERS[@]}" 2>/dev/null)"
  for f in "${SECRET_FILES[@]}"; do
    v="$(secret_value "$f")"
    [ -n "$v" ] || { fail "$label: $f is empty"; continue; }
    if [ "$f" = "db_uri" ]; then v="${v#postgres://authenticator:}"; v="${v%%@*}"; fi
    grep -qF -- "$v" <<<"$inspect" && leaks+=("$f")
  done
  [ ${#leaks[@]} -eq 0 ] && pass "$label: no secret in docker inspect of the six containers" \
    || fail "$label: in docker inspect: ${leaks[*]}"
}

health_db() {
  local body
  body="$(curl -s --max-time 10 "$BASE_URL/api/health")"
  jq -e '.db == true' >/dev/null 2>&1 <<<"$body" && pass "$1: /api/health says db: true" || fail "$1: /api/health: $(head -c 200 <<<"$body")"
}

# Creates a family from one device and joins it from a second; leaves the
# second device's cookie jar and the family id in $SCRATCH/<tag>.*
family_and_device() {
  local label="$1" tag="$2" created code fam
  created="$(curl -s -c "$SCRATCH/$tag.first.jar" -X POST "$BASE_URL/api/session/create" -H 'content-type: application/json' \
    -d "{\"familyName\":\"One-file rig $tag\",\"hardwareId\":\"claude-onefile-$tag-1\",\"deviceName\":\"claude-onefile-$tag-1\"}")"
  fam="$(jq -r '.family.id // empty' <<<"$created")"
  code="$(jq -r '.family.join_code // empty' <<<"$created")"
  if [ -z "$fam" ] || [ -z "$code" ]; then fail "$label: could not create a family: $(head -c 200 <<<"$created")"; return 1; fi
  pass "$label: created a family"
  local joined
  joined="$(curl -s -c "$SCRATCH/$tag.jar" -X POST "$BASE_URL/api/session/join" -H 'content-type: application/json' \
    -d "{\"joinCode\":\"$code\",\"hardwareId\":\"claude-onefile-$tag-2\",\"deviceName\":\"claude-onefile-$tag-2\"}")"
  if [ "$(jq -r '.family.id // empty' <<<"$joined")" = "$fam" ]; then
    pass "$label: joined it from a second device"
  else
    fail "$label: join failed: $(head -c 200 <<<"$joined")"; return 1
  fi
  echo "$fam" >"$SCRATCH/$tag.family"
}

# The second device is still signed in, to the same family, and its family's row is there.
device_still_in() {
  local label="$1" tag="$2" body fam rows
  fam="$(cat "$SCRATCH/$tag.family" 2>/dev/null)"
  body="$(curl -s -b "$SCRATCH/$tag.jar" "$BASE_URL/api/session/token")"
  if jq -e --arg f "$fam" '(.token | type == "string") and .familyId == $f' >/dev/null 2>&1 <<<"$body"; then
    pass "$label: the joined device is still signed in"
  else
    fail "$label: the joined device lost its session: $(head -c 200 <<<"$body")"
  fi
  rows="$(docker exec kinboard-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM families WHERE id = '$fam'" 2>/dev/null)"
  [ "$rows" = "1" ] && pass "$label: the family is in the database" || fail "$label: family $fam: '$rows' rows"
}

check_vapid() {
  local body
  body="$(curl -s -b "$SCRATCH/$2.jar" "$BASE_URL/api/notifications/vapid-key")"
  jq -e '.configured == true' >/dev/null 2>&1 <<<"$body" && pass "$1: push is configured (vapid-key)" \
    || fail "$1: /api/notifications/vapid-key: $(head -c 200 <<<"$body")"
}

# A job the scheduler ran to completion, from its own log line, within the budget.
wait_job() {
  local label="$1" job="$2" budget="$3" i
  for ((i = 0; i <= budget; i += 10)); do
    if docker logs kinboard-webapp 2>&1 | grep -q "internal-scheduler ▶ NOTICE \[Job \"$job\" .*Finished in .*failed: false"; then
      pass "$label: the internal scheduler ran $job (within ${i}s)"
      return 0
    fi
    sleep 10
  done
  fail "$label: no successful run of $job in the webapp log within ${budget}s"
  docker logs kinboard-webapp 2>&1 | grep 'internal-scheduler' | tail -5 | sed 's/^/     /'
  return 1
}

install_folder_untouched() {
  local left
  left="$(ls -A "$INSTALL")"
  [ "$left" = "compose.yml" ] && pass "$1: the install folder still holds only compose.yml" \
    || fail "$1: the stack wrote next to compose.yml: $(tr '\n' ' ' <<<"$left")"
}

# ------------------------------------------------------------------- fresh

if want fresh; then
  say "A1: a fresh install from the file alone"
  up_test >"$SCRATCH/up.log" 2>&1 || { fail "fresh: docker compose up failed"; sed 's/^/     /' "$SCRATCH/up.log" | tail -20; }
  if wait_healthy fresh; then
    check_services fresh
    check_secrets_store fresh
    check_inspect_clean fresh
    health_db fresh
    family_and_device fresh one
    check_vapid fresh one
    # The file declares its revision; for this image it is current, so the
    # operator (the only family) gets "not outdated" and no notice.
    rev="$(curl -s -b "$SCRATCH/one.first.jar" "$BASE_URL/api/compose-revision")"
    want_rev="$(sed -n 's/^ *KINBOARD_COMPOSE_REVISION: "\([0-9]*\)"$/\1/p' "$INSTALL/compose.yml")"
    jq -e --argjson r "${want_rev:-0}" '.revision.declared == $r and .revision.outdated == false' >/dev/null 2>&1 <<<"$rev" \
      && pass "fresh: the webapp reads the file's revision ($want_rev), not outdated" || fail "fresh: /api/compose-revision: $(head -c 200 <<<"$rev")"
    # process-notifications runs every 30 s; evaluate-attention, the job the
    # RFC names, every 5 minutes counted from the server's start.
    wait_job fresh process-notifications 120
    wait_job fresh evaluate-attention 420
    secrets_listing >"$SCRATCH/secrets.fresh"
    pg_ver="$(docker exec kinboard-db psql -U postgres -d postgres -tAc 'SELECT count(*) FROM kinboard.schema_migrations')"
    files="$(docker run --rm --entrypoint sh "$RIG_IMAGE" -c 'ls /app/migrations/[0-9]*.sql | wc -l')"
    [ "$pg_ver" = "$files" ] && pass "fresh: all $files migrations recorded" || fail "fresh: $pg_ver migrations recorded, the image has $files"

    say "A1: restart"
    dc_test restart >"$SCRATCH/restart.log" 2>&1 || fail "restart: docker compose restart failed"
    if wait_healthy restart; then
      secrets_listing >"$SCRATCH/secrets.restart"
      cmp -s "$SCRATCH/secrets.fresh" "$SCRATCH/secrets.restart" && pass "restart: every secret file unchanged (sha256, mode, owner)" \
        || { fail "restart: the secrets changed"; diff "$SCRATCH/secrets.fresh" "$SCRATCH/secrets.restart" | sed 's/^/     /'; }
      device_still_in restart one
    fi

    say "A1: down, then up"
    dc_test down >"$SCRATCH/down.log" 2>&1 || fail "down failed"
    up_test >"$SCRATCH/up2.log" 2>&1 || fail "up after down failed"
    if wait_healthy "down/up"; then
      check_services "down/up"
      secrets_listing >"$SCRATCH/secrets.downup"
      cmp -s "$SCRATCH/secrets.fresh" "$SCRATCH/secrets.downup" && pass "down/up: every secret file unchanged" || fail "down/up: the secrets changed"
      device_still_in "down/up" one
      grep -q 'secret postgres_password: kept' <<<"$(docker logs kinboard-init 2>&1)" \
        && pass "down/up: init kept the database password" || fail "down/up: init did not log 'postgres_password: kept'"
    fi
    install_folder_untouched fresh
  fi
fi

# ------------------------------------------------------------------- paste

if want paste; then
  say "A1: Portainer-style paste (-p $PASTE_PROJECT -f - from an empty folder)"
  # After `fresh`, the volumes still hold its install: the renamed stack must find it.
  if want fresh; then
    dc_test down >/dev/null 2>&1 || true
    PASTE_REUSES=1
  else
    remove_stack; remove_volumes
    PASTE_REUSES=0
  fi
  if dc "$WORK/paste" "$PASTE_PROJECT" KINBOARD_IMAGE="$IMAGE_REPO" KINBOARD_TAG="$IMAGE_TAG" WEBAPP_PORT="$RIG_WEBAPP_PORT" \
       -- -f - up -d <"$INSTALL/compose.yml" >"$SCRATCH/paste.log" 2>&1; then
    pass "paste: up from stdin"
  else
    fail "paste: up from stdin failed"; tail -20 "$SCRATCH/paste.log" | sed 's/^/     /'
  fi
  if wait_healthy paste; then
    check_services paste
    proj="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' kinboard-webapp)"
    [ "$proj" = "$PASTE_PROJECT" ] && pass "paste: the stack runs as project $PASTE_PROJECT" || fail "paste: project is '$proj'"
    [ -z "$(ls -A "$WORK/paste")" ] && pass "paste: nothing written into the folder it ran from" || fail "paste: files appeared: $(ls -A "$WORK/paste")"
    if [ "$PASTE_REUSES" = "1" ]; then
      secrets_listing >"$SCRATCH/secrets.paste"
      cmp -s "$SCRATCH/secrets.fresh" "$SCRATCH/secrets.paste" \
        && pass "paste: the renamed stack found the same secrets (fixed volume names)" || fail "paste: the secrets differ from the first stack's"
      device_still_in paste one
    else
      check_secrets_store paste
      family_and_device paste one
    fi
  fi
  dc "$WORK/paste" "$PASTE_PROJECT" -- -f - down <"$INSTALL/compose.yml" >/dev/null 2>&1 || true
fi

# ----------------------------------------------------------------- folders

if want folders; then
  say "A1: the three KINBOARD_*_DIR set to absolute host folders"
  remove_stack; remove_volumes
  DIRS="$WORK/folders"
  mkdir -p "$DIRS"
  fvars=(KINBOARD_DB_DIR="$DIRS/db" KINBOARD_STORAGE_DIR="$DIRS/storage" KINBOARD_CONFIG_DIR="$DIRS/config")
  if up_test "${fvars[@]}" >"$SCRATCH/folders.log" 2>&1; then pass "folders: up"; else fail "folders: up failed"; tail -20 "$SCRATCH/folders.log" | sed 's/^/     /'; fi
  if wait_healthy folders; then
    check_services folders
    # The secrets on the host, as root sees them (the folder is 0750 root:0).
    flist="$(docker run --rm -v "$DIRS/config":/c:ro alpine:3 sh -c 'cd /c/secrets && stat -c "%n %a %u:%g" * && stat -c "dir %a %u:%g" .')"
    [ "$(grep -c ' 640 0:0$' <<<"$flist")" = "7" ] && grep -q '^dir 750 0:0$' <<<"$flist" \
      && pass "folders: seven secret files 0640 root:0 in a 0750 folder on the host" \
      || { fail "folders: secrets on the host are not as §6.2 says"; sed 's/^/     /' <<<"$flist"; }
    docker run --rm -v "$DIRS/db":/d:ro alpine:3 test -f /d/PG_VERSION && pass "folders: the database is in the host folder" || fail "folders: no PG_VERSION in $DIRS/db"
    used="$(docker volume ls -q | grep -cxE 'kinboard-(db|storage|config)' || true)"
    [ "$used" = "0" ] && pass "folders: no Docker volume was created" || fail "folders: $used kinboard-* volume(s) created anyway"
    health_db folders
    family_and_device folders fld
    check_vapid folders fld
    wait_job folders process-notifications 120
    dc_test_with "${fvars[@]}" -- restart >/dev/null 2>&1 || true
    if wait_healthy "folders restart"; then device_still_in "folders restart" fld; fi
  fi
  dc_test_with "${fvars[@]}" -- down >/dev/null 2>&1 || true
  docker run --rm -v "$WORK":/w alpine:3 rm -rf /w/folders >/dev/null 2>&1
fi

# ----------------------------------------------------------------- upgrade

# The newest published release that has the one-file install (1.18.0, the
# first compose.yml revision), else `main`: the image just before this change.
resolve_from() {
  if [ -n "${FROM_TAG:-}" ]; then echo "$FROM_TAG"; return; fi
  local v
  v="$(docker buildx imagetools inspect "$PUBLISHED:latest" --format '{{json .Image}}' 2>/dev/null \
       | jq -r '(."linux/amd64" // .).config.Labels["org.opencontainers.image.version"] // empty' 2>/dev/null)"
  if [ -n "$v" ] && [ "$(printf '%s\n%s\n' "1.18.0" "$v" | sort -V | head -n1)" = "1.18.0" ]; then echo latest; else echo main; fi
}

if want upgrade; then
  say "A2: upgrade from the previous published image to this build, same volumes"
  remove_stack; remove_volumes
  from="$(resolve_from)"
  FROM_IMAGE="$PUBLISHED:$from"
  docker image inspect "$FROM_IMAGE" >/dev/null 2>&1 || PULLED_FROM="$FROM_IMAGE"
  if ! docker pull -q "$FROM_IMAGE" >/dev/null 2>&1; then
    fail "upgrade: could not pull $FROM_IMAGE"
  else
    from_rev="$(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$FROM_IMAGE" | cut -c1-7)"
    step "from: $FROM_IMAGE ($from_rev)"
    if [ -n "$from_rev" ] && [ "$from_rev" = "$(git -C "$REPO_ROOT" rev-parse --short=7 HEAD)" ]; then
      step "note: $FROM_IMAGE was built from this checkout's HEAD; the upgrade covers only uncommitted changes"
    fi
    dc "$INSTALL" "$RIG_PROJECT" KINBOARD_TAG="$from" WEBAPP_PORT="$RIG_WEBAPP_PORT" -- up -d >"$SCRATCH/upg1.log" 2>&1 \
      || { fail "upgrade: up on $from failed"; tail -20 "$SCRATCH/upg1.log" | sed 's/^/     /'; }
    if wait_healthy "upgrade (before)"; then
      family_and_device "upgrade (before)" upg
      secrets_listing >"$SCRATCH/secrets.before"
      db_id="$(docker inspect -f '{{.Id}}' kinboard-db)"
      web_id="$(docker inspect -f '{{.Id}}' kinboard-webapp)"
      up_test >"$SCRATCH/upg2.log" 2>&1 || { fail "upgrade: up on this build failed"; tail -20 "$SCRATCH/upg2.log" | sed 's/^/     /'; }
      if wait_healthy "upgrade (after)"; then
        check_services "upgrade (after)"
        [ "$(docker inspect -f '{{.Config.Image}}' kinboard-webapp)" = "$RIG_IMAGE" ] && pass "upgrade: the webapp runs $RIG_IMAGE" || fail "upgrade: the webapp runs $(docker inspect -f '{{.Config.Image}}' kinboard-webapp)"
        [ "$(docker inspect -f '{{.Id}}' kinboard-db)" = "$db_id" ] && pass "upgrade: the database container was not recreated" || fail "upgrade: the database container was recreated"
        [ "$(docker inspect -f '{{.Id}}' kinboard-webapp)" != "$web_id" ] && pass "upgrade: the webapp container was replaced" || fail "upgrade: the webapp container is the old one"
        secrets_listing >"$SCRATCH/secrets.after"
        cmp -s "$SCRATCH/secrets.before" "$SCRATCH/secrets.after" && pass "upgrade: every secret file unchanged" || fail "upgrade: the secrets changed"
        device_still_in upgrade upg
        check_inspect_clean upgrade
        recorded="$(docker exec kinboard-db psql -U postgres -d postgres -tAc 'SELECT count(*) FROM kinboard.schema_migrations')"
        files="$(docker run --rm --entrypoint sh "$RIG_IMAGE" -c 'ls /app/migrations/[0-9]*.sql | wc -l')"
        [ "$recorded" = "$files" ] && pass "upgrade: all $files migrations recorded" || fail "upgrade: $recorded recorded, the image has $files"
        wait_job upgrade process-notifications 120
      fi
    fi
  fi
  dc_test down >/dev/null 2>&1 || true
fi

# ------------------------------------------------------------------ guards

# Up with these variables must fail in init, before any database container exists.
expect_refused() {
  local label="$1" pattern="$2"; shift 2
  remove_stack; remove_volumes
  if dc "$INSTALL" "$RIG_PROJECT" KINBOARD_IMAGE="$IMAGE_REPO" KINBOARD_TAG="$IMAGE_TAG" WEBAPP_PORT="$RIG_WEBAPP_PORT" "$@" -- up -d >"$SCRATCH/guard.log" 2>&1; then
    fail "$label: up succeeded"
  else
    pass "$label: up failed"
  fi
  [ "$(exit_code kinboard-init)" = "exited 1" ] && pass "$label: init exited 1" || fail "$label: init is '$(exit_code kinboard-init)'"
  docker logs kinboard-init 2>&1 | grep -q -- "$pattern" && pass "$label: init says why ($pattern)" \
    || { fail "$label: init's log lacks '$pattern'"; docker logs kinboard-init 2>&1 | tail -5 | sed 's/^/     /'; }
  db_never_started "$label"
}

# Compose creates every container before it starts any, so a refused init
# leaves kinboard-db created; what matters is that it never ran.
db_never_started() {
  local started
  started="$(docker inspect -f '{{.State.StartedAt}}' kinboard-db 2>/dev/null || echo absent)"
  case "$started" in
    absent | 0001-01-01T00:00:00Z) pass "$1: the database never started ($([ "$started" = absent ] && echo 'no container' || echo 'created, never run'))" ;;
    *) fail "$1: the database container started at $started" ;;
  esac
}

if want guards; then
  say "A3: the guards"

  # The database folder on a FAT filesystem: the Unraid flash drive.
  if sudo -n true 2>/dev/null && command -v mkfs.vfat >/dev/null; then
    truncate -s 32M "$WORK/fat.img" && mkfs.vfat -n KBRIG "$WORK/fat.img" >/dev/null
    FAT_MOUNT="$WORK/fat"; mkdir -p "$FAT_MOUNT"
    if sudo -n mount -o loop,uid=0,gid=0 "$WORK/fat.img" "$FAT_MOUNT"; then
      expect_refused "FAT database folder" "FAT filesystem" KINBOARD_DB_DIR="$FAT_MOUNT"
      remove_stack
      sudo -n umount "$FAT_MOUNT" && FAT_MOUNT=""
    else
      unrehearsed "FAT database folder: the loop mount failed (not rehearsed)"
    fi
  else
    unrehearsed "FAT database folder: needs passwordless sudo and mkfs.vfat (not rehearsed)"
  fi

  # The config folder on tmpfs: gone after a reboot. /dev/shm is a tmpfs.
  if [ "$(stat -f -c %T /dev/shm 2>/dev/null)" = "tmpfs" ]; then
    SHM_DIR="$(mktemp -d /dev/shm/kinboard-one-file.XXXXXX)"
    expect_refused "tmpfs config folder" "tmpfs" KINBOARD_CONFIG_DIR="$SHM_DIR"
    remove_stack
  else
    unrehearsed "tmpfs config folder: /dev/shm is not a tmpfs here (not rehearsed)"
  fi

  # postgres_password deleted after a first start: refused, the cluster untouched.
  say "A3: postgres_password deleted after a first start"
  remove_stack; remove_volumes
  up_test >"$SCRATCH/g3.log" 2>&1 || fail "guard: the first start failed"
  if wait_healthy "guard (first start)"; then
    dc_test down >/dev/null 2>&1
    docker run --rm -v kinboard-config:/c alpine:3 rm /c/secrets/postgres_password
    before="$(docker run --rm -v kinboard-db:/d:ro alpine:3 sha256sum /d/global/pg_control | cut -d' ' -f1)"
    if up_test >"$SCRATCH/g3b.log" 2>&1; then fail "deleted password: up succeeded"; else pass "deleted password: up failed"; fi
    [ "$(exit_code kinboard-init)" = "exited 1" ] && pass "deleted password: init exited 1" || fail "deleted password: init is '$(exit_code kinboard-init)'"
    docker logs kinboard-init 2>&1 | grep -q 'postgres_password' && pass "deleted password: init names postgres_password" \
      || fail "deleted password: init's log doesn't name the file"
    [ "$(docker inspect -f '{{.State.Status}}' kinboard-db 2>/dev/null)" != "running" ] && pass "deleted password: the database is not running" \
      || fail "deleted password: the database is running"
    after="$(docker run --rm -v kinboard-db:/d:ro alpine:3 sha256sum /d/global/pg_control | cut -d' ' -f1)"
    [ -n "$before" ] && [ "$before" = "$after" ] && pass "deleted password: global/pg_control unchanged" \
      || fail "deleted password: pg_control changed ($before -> $after)"
  fi
  remove_stack; remove_volumes

  skip "CasaOS (variables replaced by literals, then imported): not rehearsed headless; listed as 'should work, not supported' (§11.8)"
  skip "go2rtc's WebRTC candidates (§8.1): needs a camera and a browser; not rehearsed headless"
fi

# ------------------------------------------------------------------ result

say "Result"
for s in "${SKIPPED[@]}"; do step "skipped: $s"; done
if [ ${#FAILURES[@]} -eq 0 ]; then
  grn "$CHECKS/$CHECKS checks passed ($RIG_PHASES)"
  exit 0
fi
red "$(( CHECKS - ${#FAILURES[@]} ))/$CHECKS checks passed; ${#FAILURES[@]} failed:"
for f in "${FAILURES[@]}"; do red "  - $f"; done
exit 1
