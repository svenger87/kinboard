#!/usr/bin/env bash
# test-upgrade.sh — prove that upgrading an existing installation works.
#
# Phase 0 of the 2026 plan asks for two things this covers:
#   "Updatepfade latest, next und Versionswechsel automatisiert testen"
#   "Upgrade von den letzten zwei Stable-Versionen erfolgreich"
#
# What it does, per FROM version:
#   1. checks out that version's tag in a worktree of its own and boots its
#      PUBLISHED image with ITS compose files and kong.yml — the install as a
#      self-hoster has it, not that image on HEAD's compose files
#   2. seeds the demo family, joins it, uploads a recipe image and a family
#      photo through the app, so there is real data and real files to lose
#   3. leaves an inactive realtime replication slot behind, as a realtime
#      container that never reconnects would
#   4. records a fingerprint of that data
#   5. upgrades exactly as `git pull` + `./start.sh up` does: HEAD's compose
#      files, the same .env and DATA_DIR, an image built from THIS worktree
#   6. asserts the stack comes back as HEAD's six services with none of the
#      retired ones left over, every migration recorded, the slot gone, the
#      files moved and served byte for byte, and the data unchanged
#
# Until 1.15 this booted the old image on HEAD's compose files and swapped
# only the image. 1.15 changes the set of services, so that would have tested
# an install that never existed.
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
  # The previous stable and the current one: where a user upgrades from.
  FROM_VERSIONS=(1.13.0 1.15.0)
fi

# Isolated from prod (kinboard: 3002/5433/8101) and kbaudit (3010/5442/8110).
RIG_PROJECT="kbupg"
# Overridable so the same rig runs on a CI runner, which has no
# /mnt/user. The default stays the Unraid path this is developed on.
RIG_DATA="${RIG_DATA:-/mnt/user/appdata/kinboard-upgrade-data}"
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
RIG_DEMO_CODE="UPGR01"

# The "after" state: use the locally built HEAD image. Cannot reuse
# docker-compose.image.yml, whose `pull_policy: always` would send docker
# to GHCR looking for a tag that only exists on this machine.
AFTER_OVERLAY="$SCRIPT_DIR/docker-compose.upgrade-target.yml"

IMAGE_COMPOSE=(-f docker-compose.yml -f docker-compose.image.yml)
AFTER_COMPOSE=(-f docker-compose.yml -f "$AFTER_OVERLAY")
# The old version's checkout, outside RIG_DATA (which is destroyed per path).
OLD_CHECKOUT="${RIG_DATA%/}-checkout"
OLD_DOCKER="$OLD_CHECKOUT/webapp/docker"
SCRATCH="${RIG_DATA%/}-scratch"

# shellcheck source=test-rig-common.sh
. "$SCRIPT_DIR/test-rig-common.sh"

# This rig runs two different compose sets across one run, so it tears both
# down rather than relying on the shared base-file teardown alone.
teardown() {
  step "tearing down"
  if [ -d "$OLD_DOCKER" ]; then
    ( cd "$OLD_DOCKER" && docker compose -p "$RIG_PROJECT" -f docker-compose.yml -f docker-compose.image.yml \
        down -v --remove-orphans >/dev/null 2>&1 ) || true
  fi
  compose AFTER_COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
  git -C "$REPO_ROOT" worktree remove --force "$OLD_CHECKOUT" >/dev/null 2>&1 || true
  rm -rf "$OLD_CHECKOUT" "$SCRATCH"
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
  # Only the recycle-bin tables: bring_removals (#407) has a deleted_at of its
  # own that records a Bring! removal and has nothing to do with soft delete.
  cols=$(psql_rig -c "SELECT count(*) FROM information_schema.columns c
                       WHERE c.table_schema='public' AND c.column_name='deleted_at'
                         AND EXISTS (SELECT 1 FROM pg_trigger t
                                      WHERE t.tgrelid = ('public.' || quote_ident(c.table_name))::regclass
                                        AND t.tgname LIKE '%soft_delete%' AND NOT t.tgisinternal);")
  funcs=$(psql_rig -c "SELECT count(*) FROM pg_proc WHERE proname IN ('purge_deleted','purge_expired');")

  [ "$triggers" = "9" ] && pass "9 soft-delete triggers"        || fail "soft-delete triggers: got '$triggers', want 9"
  [ "$cols" = "9" ]     && pass "9 tables carry deleted_at"     || fail "deleted_at columns: got '$cols', want 9"
  [ "$funcs" = "2" ]    && pass "purge_deleted + purge_expired" || fail "purge functions: got '$funcs', want 2"

  # The soft-delete predicate must survive migration_zz_row_level_security,
  # which recreates every family-scope policy on each boot. This is the
  # ordering trap that made the file migrations/056_soft_delete.sql.
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

tiny_jpeg() {
  # A real 2x2 JPEG (the backup rig's): the photo route decodes what it gets.
  printf '%s' '/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABAb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCIAOr3/9k=' | base64 -d
}

# Joins the seeded family and uploads through the OLD app: a recipe image
# (public bucket) and a family photo (private, signed). Leaves the cookie jar
# and the uploaded bytes in $SCRATCH.
seed_files() {
  mkdir -p "$SCRATCH"
  tiny_jpeg >"$SCRATCH/img.jpg"
  curl -s -c "$SCRATCH/jar" -X POST "$BASE_URL/api/session/join" -H 'content-type: application/json' \
    -d "{\"joinCode\":\"DEMO01\",\"hardwareId\":\"claude-upgrade-rig\",\"deviceName\":\"claude-upgrade-rig\"}" \
    >"$SCRATCH/join.json"
  local fam
  fam=$(sed -n 's/.*"family":{"id":"\([^"]*\)".*/\1/p' "$SCRATCH/join.json")
  [ -n "$fam" ] || { fail "could not join DEMO01: $(head -c 200 "$SCRATCH/join.json")"; return 1; }
  echo "$fam" >"$SCRATCH/family"
  curl -s -b "$SCRATCH/jar" -F "image=@$SCRATCH/img.jpg;type=image/jpeg" -F "family_id=$fam" \
    "$BASE_URL/api/recipes/upload-image" >"$SCRATCH/recipe.json"
  curl -s -b "$SCRATCH/jar" -F "photo=@$SCRATCH/img.jpg;type=image/jpeg" -F "family_id=$fam" \
    "$BASE_URL/api/photos/upload" >"$SCRATCH/photo.json"
  grep -q '"url":"/storage/v1/object/public/recipe-images/' "$SCRATCH/recipe.json" \
    && step "uploaded a recipe image" || { fail "recipe upload failed: $(head -c 200 "$SCRATCH/recipe.json")"; return 1; }
  grep -q '"storage_path"' "$SCRATCH/photo.json" \
    && step "uploaded a family photo" || { fail "photo upload failed: $(head -c 200 "$SCRATCH/photo.json")"; return 1; }
}

assert_retired() {
  say "Asserting the retired services are gone"
  local names left
  names=$(docker ps -a --filter "label=com.docker.compose.project=$RIG_PROJECT" --format '{{.Label "com.docker.compose.service"}}' | sort -u | tr '\n' ' ')
  step "services: $names"
  left=$(printf '%s\n' $names | grep -xE 'kong|auth|realtime|storage|imgproxy' | tr '\n' ' ' || true)
  [ -z "$left" ] && pass "no kong, auth, realtime, storage or imgproxy container left" \
                 || fail "retired containers still there: $left"
  local slots
  slots=$(docker exec -i "${RIG_PROJECT}-db" psql -U supabase_admin -d postgres -tA \
            -c "SELECT count(*) FROM pg_replication_slots WHERE slot_name LIKE 'supabase_realtime%'")
  [ "$slots" = "0" ] && pass "realtime's replication slot was dropped" || fail "$slots realtime slot(s) left holding WAL"
  local recorded files
  recorded=$(psql_rig -c "SELECT count(*) FROM kinboard.schema_migrations")
  files=$(ls "$SCRIPT_DIR"/migrations/[0-9]*.sql | wc -l)
  [ "$recorded" = "$files" ] && pass "all $files migrations recorded" || fail "schema_migrations has $recorded rows, $files files"
}

assert_files() {
  say "Asserting the uploaded files moved and are served"
  local url got
  url=$(sed -n 's/.*"url":"\([^"]*\)".*/\1/p' "$SCRATCH/recipe.json")
  curl -s -o "$SCRATCH/got-recipe" "$BASE_URL$url"
  cmp -s "$SCRATCH/got-recipe" "$SCRATCH/img.jpg" && pass "recipe image served byte for byte from the new store" \
                                                 || fail "recipe image at $url differs or is missing"
  curl -s -b "$SCRATCH/jar" "$BASE_URL/api/photos?family_id=$(cat "$SCRATCH/family")" >"$SCRATCH/photos.json"
  url=$(sed -n 's/.*"url":"\([^"]*\)".*/\1/p' "$SCRATCH/photos.json" | head -1)
  got=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$BASE_URL$url")
  [ "${got%% *}" = "200" ] && pass "family photo served through its signed URL ($got)" \
                           || fail "signed photo URL answered $got: $url"
  local marker
  marker=$(docker exec "${RIG_PROJECT}-webapp" cat /var/lib/storage/files/.moved-from-storage-api 2>/dev/null || true)
  case "$marker" in
    *moved=3*missing=0*) pass "entrypoint moved 3 objects, none missing ($marker)" ;;
    *) fail "unexpected file-move marker: '$marker'" ;;
  esac
  local upload
  upload=$(curl -s -b "$SCRATCH/jar" -F "image=@$SCRATCH/img.jpg;type=image/jpeg" -F "family_id=$(cat "$SCRATCH/family")" \
             "$BASE_URL/api/vehicles/upload-image")
  url=$(printf '%s' "$upload" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')
  [ -n "$url" ] && [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL$url")" = "200" ] \
    && pass "a new upload lands and is served" || fail "new upload failed: $upload"
}

# ---------------------------------------------------------------- one path

test_path() {
  local from="$1"
  say "UPGRADE PATH:  $from  ->  HEAD"

  teardown
  rig_destroy_data
  mkdir -p "$RIG_DATA"

  step "checking out v$from (its compose files, its kong.yml)"
  git -C "$REPO_ROOT" worktree add --force --detach "$OLD_CHECKOUT" "v$from" >/dev/null 2>&1 \
    || { fail "$from: no tag v$from to check out"; return 1; }
  cp "$SCRIPT_DIR/.env" "$OLD_DOCKER/.env"
  # The old setup.sh fills the old kong.yml with this .env's keys, as it did
  # on every real install of that version.
  ( cd "$OLD_CHECKOUT" && ./setup.sh --non-interactive >/dev/null 2>&1 ) || step "old setup.sh reported a problem (continuing)"
  rm -f "$OLD_CHECKOUT/webapp/.env.local"

  step "booting published image ghcr.io/svenger87/kinboard:$from with its own compose files"
  ( cd "$OLD_DOCKER" && KINBOARD_TAG="$from" \
      COMPOSE_FILES="-f docker-compose.yml -f docker-compose.image.yml" \
      ./start.sh up >/dev/null 2>&1 ) || { fail "$from: start.sh up failed"; teardown; return 1; }
  rig_wait_healthy "$from" || { teardown; return 1; }
  local running
  running=$(docker inspect -f '{{.Config.Image}}' "${RIG_PROJECT}-webapp")
  step "running: $running"
  step "seeding the demo family"
  ( cd "$OLD_DOCKER" && KINBOARD_TAG="$from" \
      COMPOSE_FILES="-f docker-compose.yml -f docker-compose.image.yml" \
      ./start.sh seed-demo >/dev/null 2>&1 ) || step "seed-demo reported a problem (continuing)"
  seed_files || { teardown; return 1; }
  docker exec -i "${RIG_PROJECT}-db" psql -U supabase_admin -d postgres -tAq \
    -c "SELECT pg_create_logical_replication_slot('supabase_realtime_upgrade_rig', 'pgoutput')" >/dev/null \
    && step "left an inactive realtime replication slot behind"
  local before
  before=$(fingerprint)
  step "before: $before"

  say "Upgrading to HEAD (git pull + setup.sh + start.sh up)"
  # The .env as the old version left it (its start.sh may have moved the
  # install to Kong as the front door), carried over as a pull would.
  cp "$OLD_DOCKER/.env" "$SCRIPT_DIR/.env"
  ( cd "$REPO_ROOT" && ./setup.sh --non-interactive >/dev/null 2>&1 ) || fail "HEAD setup.sh failed on the old .env"
  rm -f "$REPO_ROOT/webapp/.env.local"
  ( cd "$SCRIPT_DIR" && \
      COMPOSE_FILES="-f docker-compose.yml -f docker-compose.upgrade-target.yml" \
      ./start.sh up >/dev/null 2>&1 ) || { fail "$from -> HEAD: start.sh up failed"; teardown; return 1; }
  rig_wait_healthy "HEAD (from $from)" || { teardown; return 1; }

  running=$(docker inspect -f '{{.Config.Image}}' "${RIG_PROJECT}-webapp")
  step "running: $running"

  assert_entrypoint_clean
  assert_retired
  assert_head_schema "$from"
  assert_files

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

rig_prepare_env
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
