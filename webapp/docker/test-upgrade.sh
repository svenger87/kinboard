#!/usr/bin/env bash
# test-upgrade.sh — prove that upgrading an existing installation works.
#
# Phase 0 of the 2026 plan asks for two things this covers:
#   "Updatepfade latest, next und Versionswechsel automatisiert testen"
#   "Upgrade von den letzten zwei Stable-Versionen erfolgreich"
#
# What it does, per FROM version:
#   1. boots the PUBLISHED image for that version on an isolated stack
#   2. seeds the demo family, so there is real data to lose
#   3. records a fingerprint of that data
#   4. upgrades to an image built from THIS worktree (i.e. HEAD)
#   5. asserts the stack comes back up, the schema HEAD promises exists,
#      and the data survived
#
# Why the schema assertion is shaped the way it is: there is no migration
# bookkeeping table. webapp-entrypoint.sh re-runs every migration*.sql on
# every start, so "which migrations ran" is not a question the database can
# answer. What matters to a self-hoster is whether the objects the new
# version needs are actually there afterwards, so that is what we check.
#
# Isolation: its own compose project, its own DATA_DIR and its own ports.
# It never touches the production stack or kbaudit. Nothing here is
# destructive to anything outside RIG_DATA.
#
# Usage:
#   ./test-upgrade.sh                 # last two stable versions
#   ./test-upgrade.sh 1.7.0           # one specific version
#   KEEP_UP=1 ./test-upgrade.sh 1.7.0 # leave the stack running to poke at

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$SCRIPT_DIR"

FROM_VERSIONS=("$@")
if [ ${#FROM_VERSIONS[@]} -eq 0 ]; then
  FROM_VERSIONS=(1.7.0 1.6.10)
fi

# Isolated from prod (kinboard: 3002/5433/8101) and kbaudit (3010/5442/8110).
RIG_PROJECT="kbupg"
RIG_DATA="/mnt/user/appdata/kinboard-upgrade-data"
RIG_WEBAPP_PORT=3021
RIG_POSTGRES_PORT=5452
RIG_KONG_HTTP_PORT=8120
RIG_KONG_HTTPS_PORT=8563
RIG_GO2RTC_HTTP_PORT=1994
RIG_GO2RTC_WEBRTC_PORT=8575
# The compose network pins a fixed subnet, so a second stack on the default
# collides with "Pool overlaps with other one on this address space".
# Taken on this host: 10.200 (familycalendar), 10.201 (prod), 10.209 (kbaudit).
RIG_NETWORK_SUBNET="10.220.0.0/24"

# Overridable so the assertions can be proved non-vacuous: point the "after"
# image at the SAME old version and every HEAD-schema check must go red.
#   HEAD_IMAGE=ghcr.io/svenger87/kinboard:1.7.0 SKIP_BUILD=1 ./test-upgrade.sh 1.7.0
HEAD_IMAGE="${HEAD_IMAGE:-kinboard-upgrade-test:local}"
BASE_URL="http://localhost:${RIG_WEBAPP_PORT}"

# The "after" state: use the locally built HEAD image. Cannot reuse
# docker-compose.image.yml, whose `pull_policy: always` would send docker
# to GHCR looking for a tag that only exists on this machine.
AFTER_OVERLAY="$SCRIPT_DIR/docker-compose.upgrade-target.yml"

IMAGE_COMPOSE=(-f docker-compose.yml -f docker-compose.image.yml)
AFTER_COMPOSE=(-f docker-compose.yml -f "$AFTER_OVERLAY")

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
step() { printf '   %s\n' "$*"; }

FAILURES=()
fail() { red "   FAIL: $*"; FAILURES+=("$*"); }
pass() { grn "   ok:   $*"; }

compose() {
  local -n files=$1; shift
  ( cd "$SCRIPT_DIR" && \
    COMPOSE_PROJECT_NAME="$RIG_PROJECT" \
    docker compose -p "$RIG_PROJECT" "${files[@]}" "$@" )
}

psql_rig() {
  docker exec -i "${RIG_PROJECT}-db" psql -U postgres -d postgres -tA "$@"
}

teardown() {
  step "tearing down"
  compose IMAGE_COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
  compose AFTER_COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
}

wait_healthy() {
  local label="$1" budget="${2:-90}"
  step "waiting for the stack to answer ($label, up to $((budget*5))s)"
  for i in $(seq 1 "$budget"); do
    if curl -sfo /dev/null --max-time 3 "$BASE_URL/api/setup/status"; then
      step "ready after $((i*5))s"
      return 0
    fi
    sleep 5
  done
  fail "$label: stack never became ready"
  step "--- webapp logs (last 40) ---"
  compose AFTER_COMPOSE logs --tail=40 webapp 2>&1 | sed 's/^/     /' || true
  return 1
}

# ---------------------------------------------------------------- env setup

prepare_env() {
  say "Preparing an isolated .env"
  if [ ! -f "$SCRIPT_DIR/.env" ]; then
    # setup.sh substitutes real JWTs into kong.yml (and touches diun.yml).
    # Production marks both skip-worktree so they can never be committed;
    # a fresh worktree gets them as ordinary tracked files, so `git add -A`
    # here would commit generated keys. Mirror production's protection
    # before running setup.sh, not after.
    ( cd "$REPO_ROOT" && git update-index --skip-worktree \
        webapp/docker/kong.yml webapp/docker/diun/diun.yml 2>/dev/null ) || true
    step "marked kong.yml + diun.yml skip-worktree (as production does)"
    ( cd "$REPO_ROOT" && ./setup.sh --non-interactive >/dev/null )
    step "generated secrets via setup.sh --non-interactive"
  else
    step "reusing existing rig .env"
  fi

  # Point every collidable knob at the rig's own value.
  local -A overrides=(
    [PROJECT_NAME]="$RIG_PROJECT"
    [COMPOSE_PROJECT_NAME]="$RIG_PROJECT"
    [DATA_DIR]="$RIG_DATA"
    [WEBAPP_PORT]="$RIG_WEBAPP_PORT"
    [POSTGRES_PORT]="$RIG_POSTGRES_PORT"
    [KONG_HTTP_PORT]="$RIG_KONG_HTTP_PORT"
    [KONG_HTTPS_PORT]="$RIG_KONG_HTTPS_PORT"
    [GO2RTC_HTTP_PORT]="$RIG_GO2RTC_HTTP_PORT"
    [GO2RTC_WEBRTC_PORT]="$RIG_GO2RTC_WEBRTC_PORT"
    [KINBOARD_PROJECT_DIR]="$REPO_ROOT"
    [KINBOARD_DEMO_FAMILY_CODE]="UPGR01"
    [NETWORK_SUBNET]="$RIG_NETWORK_SUBNET"
  )
  for key in "${!overrides[@]}"; do
    local val="${overrides[$key]}"
    if grep -q "^${key}=" "$SCRIPT_DIR/.env"; then
      sed -i "s|^${key}=.*|${key}=${val}|" "$SCRIPT_DIR/.env"
    else
      printf '%s=%s\n' "$key" "$val" >> "$SCRIPT_DIR/.env"
    fi
  done
  # COMPOSE_FILES in .env would override our explicit -f lists.
  sed -i '/^COMPOSE_FILES=/d' "$SCRIPT_DIR/.env"

  # setup.sh copies webapp/.env.example to webapp/.env.local verbatim, and
  # that file carries NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000 plus
  # placeholder keys. Next.js inlines NEXT_PUBLIC_* at BUILD time, so
  # building with it present bakes localhost:8000 into the client bundle —
  # the failure that took production down on 2026-08-06. The container gets
  # its real values from compose at runtime and the published image is built
  # without this file, so removing it is both safe and necessary here.
  if [ -f "$REPO_ROOT/webapp/.env.local" ]; then
    rm -f "$REPO_ROOT/webapp/.env.local"
    step "removed webapp/.env.local that setup.sh created (would poison the build)"
  fi
  step "ports: webapp=$RIG_WEBAPP_PORT db=$RIG_POSTGRES_PORT kong=$RIG_KONG_HTTP_PORT"
  step "data:  $RIG_DATA"
}

build_head_image() {
  if [ "${SKIP_BUILD:-0}" = "1" ]; then
    say "SKIP_BUILD=1 — using $HEAD_IMAGE as the upgrade target"
    docker image inspect "$HEAD_IMAGE" >/dev/null 2>&1 || docker pull -q "$HEAD_IMAGE" >/dev/null
    return 0
  fi
  say "Building the HEAD image from this worktree"
  if [ -f "$REPO_ROOT/webapp/.env.local" ]; then
    red "REFUSING: webapp/.env.local exists in this worktree."
    red "It would bake localhost:8000 into the bundle (this took prod down once)."
    exit 1
  fi
  docker build -q -f "$REPO_ROOT/webapp/docker/Dockerfile" \
    -t "$HEAD_IMAGE" "$REPO_ROOT/webapp" | tail -1
  # The same check the runbook demands before any local image is deployed.
  local hits
  hits=$(docker run --rm --entrypoint sh "$HEAD_IMAGE" \
           -c 'grep -rl "localhost:8000" /app/.next/ 2>/dev/null | wc -l')
  if [ "$hits" != "0" ]; then
    red "REFUSING: built image has localhost:8000 baked in ($hits files)."
    exit 1
  fi
  step "built $HEAD_IMAGE, clean of localhost:8000"
}

write_after_overlay() {
  cat > "$AFTER_OVERLAY" <<YAML
# Generated by test-upgrade.sh — the "after" half of the upgrade.
# Uses the locally built HEAD image. Deliberately not docker-compose.image.yml:
# that file sets pull_policy: always, which would go to GHCR for a tag that
# only exists on this machine.
services:
  webapp:
    image: ${HEAD_IMAGE}
    build: !reset null
    pull_policy: never
YAML
}

# ---------------------------------------------------------------- assertions

fingerprint() {
  psql_rig <<'SQL'
SELECT 'people='       || (SELECT count(*) FROM public.people)
    || ' birthdays='   || (SELECT count(*) FROM public.birthdays)
    || ' todos='       || (SELECT count(*) FROM public.todos)
    || ' families='    || (SELECT count(*) FROM public.families);
SQL
}

assert_head_schema() {
  local from="$1"
  say "Asserting the schema HEAD promises exists (upgraded from $from)"

  # The recycle bin landed after 1.7.0, so on both tested paths these
  # objects must be created BY the upgrade, not inherited.
  local triggers cols funcs
  triggers=$(psql_rig -c "SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%soft_delete%' AND NOT tgisinternal;")
  cols=$(psql_rig -c "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND column_name='deleted_at';")
  funcs=$(psql_rig -c "SELECT count(*) FROM pg_proc WHERE proname IN ('purge_deleted','purge_expired');")

  [ "$triggers" = "9" ] && pass "9 soft-delete triggers"        || fail "soft-delete triggers: got '$triggers', want 9"
  [ "$cols" = "9" ]     && pass "9 tables carry deleted_at"     || fail "deleted_at columns: got '$cols', want 9"
  [ "$funcs" = "2" ]    && pass "purge_deleted + purge_expired" || fail "purge functions: got '$funcs', want 2"

  # The soft-delete predicate must survive migration_zz_row_level_security,
  # which recreates every family-scope policy on each boot. This is the
  # ordering trap that made the file migration_zzz_soft_delete.sql.
  local policy
  policy=$(psql_rig -c "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='birthdays' AND qual LIKE '%deleted_at%';")
  [ "$policy" != "0" ] && pass "RLS still carries the deleted_at predicate" \
                       || fail "RLS lost the deleted_at predicate (migration ordering regression)"
}

assert_entrypoint_clean() {
  say "Checking the migration runner did not crash-loop"
  local logs
  logs=$(compose AFTER_COMPOSE logs webapp 2>&1 || true)
  if grep -q 'GIVING UP' <<<"$logs"; then
    fail "entrypoint gave up on migrations"
    grep -n 'FAILED\|GIVING UP' <<<"$logs" | head -5 | sed 's/^/     /'
  else
    pass "no 'GIVING UP' in the entrypoint log"
  fi
  local retries
  retries=$(grep -c 'migration attempt .* failed' <<<"$logs" || true)
  [ "$retries" = "0" ] && pass "migrations applied first try" \
                       || step "note: $retries migration retry/retries (tolerated on first boot)"
}

# ---------------------------------------------------------------- one path

test_path() {
  local from="$1"
  say "UPGRADE PATH:  $from  ->  HEAD"

  teardown
  rm -rf "$RIG_DATA"
  mkdir -p "$RIG_DATA"

  step "booting published image ghcr.io/svenger87/kinboard:$from"
  # Must go through start.sh, not `docker compose up`: start.sh realigns the
  # supabase role passwords against POSTGRES_PASSWORD on every up. The
  # official postgres image seeds those roles with empty passwords, so
  # skipping that step crash-loops auth, rest and storage on
  # `password authentication failed`.
  ( cd "$SCRIPT_DIR" && KINBOARD_TAG="$from" \
      COMPOSE_FILES="-f docker-compose.yml -f docker-compose.image.yml" \
      ./start.sh up >/dev/null 2>&1 ) || { fail "$from: start.sh up failed"; teardown; return 1; }
  wait_healthy "$from" || { teardown; return 1; }

  local running
  running=$(docker inspect -f '{{.Config.Image}}' "${RIG_PROJECT}-webapp")
  step "running: $running"

  step "seeding the demo family"
  ( cd "$SCRIPT_DIR" && KINBOARD_TAG="$from" \
      COMPOSE_FILES="-f docker-compose.yml -f docker-compose.image.yml" \
      ./start.sh seed-demo >/dev/null 2>&1 ) || step "seed-demo reported a problem (continuing)"

  local before
  before=$(fingerprint)
  step "before: $before"

  say "Upgrading to HEAD"
  ( cd "$SCRIPT_DIR" && \
      COMPOSE_FILES="-f docker-compose.yml -f docker-compose.upgrade-target.yml" \
      ./start.sh up >/dev/null 2>&1 ) || { fail "$from -> HEAD: start.sh up failed"; teardown; return 1; }
  wait_healthy "HEAD (from $from)" || { teardown; return 1; }

  running=$(docker inspect -f '{{.Config.Image}}' "${RIG_PROJECT}-webapp")
  step "running: $running"

  assert_entrypoint_clean
  assert_head_schema "$from"

  say "Asserting the data survived"
  local after
  after=$(fingerprint)
  step "after:  $after"
  [ "$before" = "$after" ] && pass "row counts identical across the upgrade" \
                           || fail "data changed across upgrade: '$before' -> '$after'"

  if [ "${KEEP_UP:-0}" = "1" ]; then
    say "KEEP_UP=1 — leaving the stack up at $BASE_URL"
  else
    teardown
  fi
}

# ---------------------------------------------------------------- main

say "Kinboard upgrade-path test"
step "from: ${FROM_VERSIONS[*]}  ->  HEAD ($(cd "$REPO_ROOT" && git rev-parse --short HEAD))"

prepare_env
write_after_overlay
build_head_image

for v in "${FROM_VERSIONS[@]}"; do
  test_path "$v" || fail "$v -> HEAD: path aborted"
done

say "Result"
if [ ${#FAILURES[@]} -eq 0 ]; then
  grn "All upgrade paths passed: ${FROM_VERSIONS[*]} -> HEAD"
  exit 0
fi
red "${#FAILURES[@]} failure(s):"
for f in "${FAILURES[@]}"; do red "  - $f"; done
exit 1
