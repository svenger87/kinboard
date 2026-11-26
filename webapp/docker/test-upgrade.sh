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
# The rollback case (--rollback, RFC-023 §4.11.4) runs the other direction:
#   1. boots HEAD's image on HEAD's compose files, so the database carries
#      every migration HEAD has, and writes a task through it
#   2. swaps only the webapp image back to the previous release's PUBLISHED
#      image, as the updater's rollback does: same compose files, same
#      database, nothing else recreated
#   3. asserts it comes up healthy without touching the migrations, then joins,
#      reads HEAD's task and writes and completes one of its own
#   4. rolls forward to HEAD again and checks both tasks are there
# It is what keeps "migrations are additive, so the older image runs on the
# newer schema" (UPGRADING.md) true in practice; check-additive-migrations.mjs
# keeps it true on paper.
#
# Usage:
#   ./test-upgrade.sh                 # last two stable versions
#   ./test-upgrade.sh 1.7.0           # one specific version
#   KEEP_UP=1 ./test-upgrade.sh 1.7.0 # leave the stack running to poke at
#   ./test-upgrade.sh --rollback      # previous release on HEAD's schema
#   ./test-upgrade.sh --rollback 1.16.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$SCRIPT_DIR"

MODE=upgrade
if [ "${1:-}" = "--rollback" ]; then
  MODE=rollback
  shift
  # The newest stable release: the one an update to HEAD would fall back to.
  ROLLBACK_TO="${1:-$(git -C "$REPO_ROOT" tag --list 'v[0-9]*' --sort=-v:refname | grep -v -- - | head -1 | sed 's/^v//')}"
  [ -n "$ROLLBACK_TO" ] || { echo "no stable v* tag to roll back to; fetch tags or name a version" >&2; exit 2; }
  set --
fi

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
# The rollback case's "back" half: HEAD's compose files, the previous
# release's published image. Generated, gitignored, removed on teardown.
ROLLBACK_OVERLAY="$SCRIPT_DIR/docker-compose.rollback-target.yml"
ROLLBACK_COMPOSE=(-f docker-compose.yml -f "$ROLLBACK_OVERLAY")

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
  rm -f "$ROLLBACK_OVERLAY"
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
    --build-arg BUILD_REVISION="$(git -C "$REPO_ROOT" rev-parse --short=7 HEAD)" \
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
  # Only an install from before 1.15 has a storage-api tree to move out of.
  # One that already ran 1.15 stored its uploads in the new layout to begin
  # with, so there is nothing to move and no marker.
  case "$1" in
    1.[0-9].*|1.1[0-4].*)
      case "$marker" in
        *moved=3*missing=0*) pass "entrypoint moved 3 objects, none missing ($marker)" ;;
        *) fail "unexpected file-move marker: '$marker'" ;;
      esac ;;
    *)
      [ -z "$marker" ] && pass "already in the new layout: nothing moved, no marker" \
                       || fail "a move ran on an install that was already 1.15 or later: '$marker'" ;;
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
  assert_files "$from"

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

# ---------------------------------------------------------------- rollback

# Join the seeded family as a new device and fetch the family token the
# browser uses for /rest/v1. Leaves "$SCRATCH/$1.jar" and "$SCRATCH/$1.token".
join_device() {
  local who="$1"
  curl -s -c "$SCRATCH/$who.jar" -X POST "$BASE_URL/api/session/join" -H 'content-type: application/json' \
    -d "{\"joinCode\":\"DEMO01\",\"hardwareId\":\"claude-rollback-$who\",\"deviceName\":\"claude-rollback-$who\"}" \
    >"$SCRATCH/$who.join.json"
  local fam
  fam=$(sed -n 's/.*"family":{"id":"\([^"]*\)".*/\1/p' "$SCRATCH/$who.join.json")
  [ -n "$fam" ] || { fail "$who: could not join DEMO01: $(head -c 200 "$SCRATCH/$who.join.json")"; return 1; }
  echo "$fam" >"$SCRATCH/family"
  curl -s -b "$SCRATCH/$who.jar" "$BASE_URL/api/session/token" \
    | sed -n 's/.*"token":"\([^"]*\)".*/\1/p' >"$SCRATCH/$who.token"
  [ -s "$SCRATCH/$who.token" ] || { fail "$who: joined, but /api/session/token handed out no token"; return 1; }
  pass "$who: joined DEMO01 and got a family token"
}

# rest <who> <method> <path> [json] -> prints "<status> <body>"
rest() {
  local who="$1" method="$2" path="$3" body="${4:-}"
  local args=(-s -o "$SCRATCH/rest.out" -w '%{http_code}' -X "$method"
              -H "Authorization: Bearer $(cat "$SCRATCH/$who.token")"
              -H 'content-type: application/json' -H 'Prefer: return=representation')
  [ -n "$body" ] && args+=(-d "$body")
  local code
  code=$(curl "${args[@]}" "$BASE_URL/rest/v1/$path")
  printf '%s %s' "$code" "$(cat "$SCRATCH/rest.out")"
}

write_task() {
  local who="$1" title="$2" out
  out=$(rest "$who" POST todos "{\"family_id\":\"$(cat "$SCRATCH/family")\",\"title\":\"$title\"}")
  [ "${out%% *}" = "201" ] || { fail "$who: writing task '$title' answered ${out:0:200}"; return 1; }
  local id
  id=$(printf '%s' "$out" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
  out=$(rest "$who" PATCH "todos?id=eq.$id" '{"completed":true}')
  [ "${out%% *}" = "200" ] && printf '%s' "$out" | grep -q '"completed":true' \
    && pass "$who: wrote task '$title' and completed it" \
    || { fail "$who: completing '$title' answered ${out:0:200}"; return 1; }
}

read_tasks() {
  local who="$1" out
  out=$(rest "$who" GET "todos?select=title&title=like.rollback-rig*&order=title")
  [ "${out%% *}" = "200" ] || { fail "$who: reading tasks answered ${out:0:200}"; return 1; }
  printf '%s' "${out#* }" | grep -o '"title":"[^"]*"' | sed 's/"title":"//; s/"$//' | tr '\n' ' ' | sed 's/ $//'
}

# Wait for Docker's own health verdict on the webapp (the /api/health probe,
# which includes the database), as the updater does (§4.11.4).
wait_docker_healthy() {
  local label="$1" budget="${2:-60}" st=""
  for i in $(seq 1 "$budget"); do
    st=$(docker inspect -f '{{.State.Health.Status}}' "${RIG_PROJECT}-webapp" 2>/dev/null || echo gone)
    [ "$st" = "healthy" ] && { pass "$label: container healthy after $((i*5))s"; return 0; }
    sleep 5
  done
  fail "$label: container health is '$st' after $((budget*5))s"
  return 1
}

test_rollback() {
  local prev="$1" prev_image="ghcr.io/svenger87/kinboard:$1"
  say "ROLLBACK:  HEAD's schema  ->  $prev_image"
  teardown
  rig_destroy_data
  mkdir -p "$RIG_DATA" "$SCRATCH"
  rm -f "$SCRATCH"/*.jar "$SCRATCH"/*.token

  # What the older image will meet: migrations it has never seen, and any it
  # has whose content HEAD changed (its runner re-applies those, and every
  # file after them, in its own older version).
  local newer edited
  newer=$(comm -13 <(git -C "$REPO_ROOT" ls-tree --name-only "v$prev" webapp/docker/migrations/ 2>/dev/null | xargs -rn1 basename | sort) \
                   <(ls "$SCRIPT_DIR"/migrations/ | grep -E '^[0-9]+_.*\.sql$' | sort) | tr '\n' ' ')
  edited=$(git -C "$REPO_ROOT" diff --name-only --diff-filter=M "v$prev" -- webapp/docker/migrations/ 2>/dev/null | xargs -rn1 basename | tr '\n' ' ')
  step "migrations HEAD has that $prev lacks: ${newer:-none}"
  step "migrations HEAD changed since $prev:  ${edited:-none}"
  [ -n "$newer$edited" ] || step "note: same migrations on both sides, so this run checks the rollback mechanics, not a schema difference"

  step "pulling $prev_image"
  docker pull -q "$prev_image" >/dev/null || { fail "could not pull $prev_image"; return 1; }
  cat > "$ROLLBACK_OVERLAY" <<YAML
# Generated by test-upgrade.sh --rollback: the previous release's image on
# HEAD's compose files, as the updater's rollback runs it.
services:
  webapp:
    image: ${prev_image}
    pull_policy: never
YAML

  say "Booting HEAD ($HEAD_IMAGE) on a fresh database"
  local t0=$SECONDS
  ( cd "$SCRIPT_DIR" && COMPOSE_FILES="-f docker-compose.yml -f docker-compose.upgrade-target.yml" \
      ./start.sh up >/dev/null 2>&1 ) || { fail "HEAD: start.sh up failed"; teardown; return 1; }
  rig_wait_healthy "HEAD" || { teardown; return 1; }
  ( cd "$SCRIPT_DIR" && COMPOSE_FILES="-f docker-compose.yml -f docker-compose.upgrade-target.yml" \
      ./start.sh seed-demo >/dev/null 2>&1 ) || step "seed-demo reported a problem (continuing)"
  local recorded files
  recorded=$(psql_rig -c "SELECT count(*) FROM kinboard.schema_migrations")
  files=$(ls "$SCRIPT_DIR"/migrations/[0-9]*.sql | wc -l)
  [ "$recorded" = "$files" ] && pass "HEAD applied all $files migrations" \
                             || { fail "HEAD recorded $recorded of $files migrations"; teardown; return 1; }
  join_device head && write_task head "rollback-rig 1 written by HEAD" || { teardown; return 1; }
  # Proving the case non-vacuous: apply a destructive change as if it were a
  # HEAD migration, and the checks on the older image must go red.
  #   ROLLBACK_INJECT_SQL='ALTER TABLE public.todos RENAME COLUMN completed TO done' \
  #     ./test-upgrade.sh --rollback
  if [ -n "${ROLLBACK_INJECT_SQL:-}" ]; then
    step "ROLLBACK_INJECT_SQL: $ROLLBACK_INJECT_SQL"
    psql_rig -v ON_ERROR_STOP=1 -c "$ROLLBACK_INJECT_SQL" -c "NOTIFY pgrst, 'reload schema'" >/dev/null \
      || { fail "ROLLBACK_INJECT_SQL did not apply"; teardown; return 1; }
  fi
  local sums_before db_before
  sums_before=$(psql_rig -c "SELECT md5(string_agg(name || checksum, ',' ORDER BY name)) FROM kinboard.schema_migrations")
  db_before=$(docker inspect -f '{{.Id}}' "${RIG_PROJECT}-db")
  step "HEAD up and written to in $((SECONDS - t0))s"

  say "Rolling the webapp back to $prev (image only, HEAD's compose files)"
  t0=$SECONDS
  compose ROLLBACK_COMPOSE up -d --no-deps webapp >/dev/null 2>&1 \
    || { fail "rollback: compose up failed"; teardown; return 1; }
  rig_wait_healthy "$prev on HEAD's schema" || { teardown; return 1; }
  wait_docker_healthy "$prev" || { teardown; return 1; }
  step "back on $prev in $((SECONDS - t0))s"

  local running
  running=$(docker inspect -f '{{.Config.Image}}' "${RIG_PROJECT}-webapp")
  [ "$running" = "$prev_image" ] && pass "running $running" || fail "running '$running', expected $prev_image"
  [ "$(docker inspect -f '{{.Id}}' "${RIG_PROJECT}-db")" = "$db_before" ] \
    && pass "database container untouched by the rollback" || fail "the rollback recreated the database container"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$BASE_URL/api/health")
  [ "$code" = "200" ] && pass "/api/health 200 on $prev" || fail "/api/health answered $code on $prev"

  local logs
  logs=$(compose ROLLBACK_COMPOSE logs webapp 2>&1 || true)
  if grep -q 'GIVING UP\|\[migrate\] FAILED' <<<"$logs"; then
    fail "$prev's migration runner failed on HEAD's schema"
    grep -n 'FAILED\|GIVING UP' <<<"$logs" | head -5 | sed 's/^/     /'
  else
    pass "$prev's migration runner did not fail"
  fi
  grep -o '\[migrate\] done: .*' <<<"$logs" | tail -1 | sed 's/^/   /'
  local reapplied
  reapplied=$(grep -c '\[migrate\] re-applying' <<<"$logs" || true)
  [ "$reapplied" = "0" ] || step "note: $prev re-applied $reapplied migration(s) in its own version (edited since $prev)"
  recorded=$(psql_rig -c "SELECT count(*) FROM kinboard.schema_migrations")
  [ "$recorded" = "$files" ] && pass "schema_migrations still lists all $files" \
                             || fail "schema_migrations has $recorded rows after the rollback, $files before"

  say "Smoke on $prev: join, read, write"
  join_device prev || { teardown; return 1; }
  local seen
  seen=$(read_tasks prev)
  [ "$seen" = "rollback-rig 1 written by HEAD" ] && pass "$prev reads HEAD's task" \
                                                || fail "$prev read tasks '$seen'"
  write_task prev "rollback-rig 2 written by $prev" || true
  seen=$(read_tasks prev)
  [ "$seen" = "rollback-rig 1 written by HEAD rollback-rig 2 written by $prev" ] \
    && pass "$prev reads both tasks back" || fail "$prev read back '$seen'"

  say "Rolling forward to HEAD again"
  t0=$SECONDS
  compose AFTER_COMPOSE up -d --no-deps webapp >/dev/null 2>&1 \
    || { fail "roll forward: compose up failed"; teardown; return 1; }
  rig_wait_healthy "HEAD again" || { teardown; return 1; }
  wait_docker_healthy "HEAD again" || { teardown; return 1; }
  step "HEAD again in $((SECONDS - t0))s"
  local sums_after
  sums_after=$(psql_rig -c "SELECT md5(string_agg(name || checksum, ',' ORDER BY name)) FROM kinboard.schema_migrations")
  [ "$sums_after" = "$sums_before" ] && pass "migration records identical to before the rollback" \
                                     || fail "migration records differ after rolling forward"
  seen=$(read_tasks head)
  [ "$seen" = "rollback-rig 1 written by HEAD rollback-rig 2 written by $prev" ] \
    && pass "HEAD reads the task $prev wrote" || fail "HEAD read back '$seen'"

  if [ "${KEEP_UP:-0}" = "1" ]; then
    say "KEEP_UP=1 — leaving the stack up at $BASE_URL"
  else
    teardown
  fi
}

# ---------------------------------------------------------------- main

if [ "$MODE" = "rollback" ]; then
  say "Kinboard rollback test"
  step "HEAD ($(cd "$REPO_ROOT" && git rev-parse --short HEAD))  ->  $ROLLBACK_TO"
else
  say "Kinboard upgrade-path test"
  step "from: ${FROM_VERSIONS[*]}  ->  HEAD ($(cd "$REPO_ROOT" && git rev-parse --short HEAD))"
fi

rig_prepare_env
write_after_overlay
build_head_image

if [ "$MODE" = "rollback" ]; then
  RIG_T0=$SECONDS
  test_rollback "$ROLLBACK_TO" || fail "rollback to $ROLLBACK_TO: aborted"
  say "Result"
  if [ ${#FAILURES[@]} -eq 0 ]; then
    grn "Rollback passed: $ROLLBACK_TO runs on HEAD's schema ($((SECONDS - RIG_T0))s)"
    exit 0
  fi
  red "${#FAILURES[@]} failure(s):"
  for f in "${FAILURES[@]}"; do red "  - $f"; done
  exit 1
fi

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
