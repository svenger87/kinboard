#!/usr/bin/env bash
# Kinboard — local Docker operations.
#
# Usage:
#   ./start.sh up        # bring stack up
#   ./start.sh down      # tear down
#   ./start.sh restart   # rebuild webapp + restart
#   ./start.sh logs      # tail logs
#   ./start.sh status    # show container state
#   ./start.sh migrate   # apply migration*.sql files
#   ./start.sh seed-demo # load optional demo family + subjects
#
# Compose file selection: defaults to `docker-compose.yml`. If you
# also have `docker-compose.image.yml` in this directory, it's
# auto-included so `up` pulls the published image instead of trying
# to build from a source tree that may not be on disk (image-pull
# self-host deployments). Override the full set in .env or your
# shell, e.g.:
#   COMPOSE_FILES="-f docker-compose.yml -f docker-compose.image.yml -f docker-compose.traefik.yml"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  echo "error: $SCRIPT_DIR/.env is missing." >&2
  echo "       run \`./setup.sh\` from the repo root, or copy" >&2
  echo "       .env.example to .env and fill in the values." >&2
  exit 1
fi

# Source .env so user-set vars (especially COMPOSE_FILES) take
# effect for this script's own logic. docker compose reads .env on
# its own for compose-file substitution, but doesn't propagate
# COMPOSE_FILES back into the calling shell.
set -a
# shellcheck disable=SC1091
. ./.env
set +a

# Pick a sensible compose-file default. Source-build self-hosters get
# the base file; image-pull self-hosters automatically also get the
# image overlay if they have docker-compose.image.yml present (which
# they do if they followed the published-image path in the wiki).
# Reverse-proxy users (Traefik) and demo overlays still need to be
# specified explicitly via COMPOSE_FILES — they're not always-on.
if [[ -z "${COMPOSE_FILES:-}" ]]; then
  if [[ -f docker-compose.image.yml ]]; then
    COMPOSE_FILES="-f docker-compose.yml -f docker-compose.image.yml"
  else
    COMPOSE_FILES="-f docker-compose.yml"
  fi
fi
if command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  COMPOSE="docker compose"
fi

cmd="${1:-up}"

# Source .env so PROJECT_NAME / POSTGRES_PASSWORD are available to the
# helper functions below.
set -a
# shellcheck disable=SC1091
source ./.env
set +a
PROJECT_NAME="${PROJECT_NAME:-kinboard}"

# NOTE: supabase service-role password alignment (authenticator,
# supabase_auth_admin, supabase_storage_admin) + the `_realtime` schema now
# happen INSIDE the stack via the one-shot `db-init` service in
# docker-compose.yml, gated so auth/rest/storage/realtime wait for it. That
# makes a bare `docker compose up` work without this script. We no longer
# align passwords from the host here.

# Apply every webapp/docker/migration*.sql to the running DB, by hand.
#
# THIS IS NOT THE PATH MIGRATIONS NORMALLY TAKE. The webapp container applies
# them itself on every start (webapp-entrypoint.sh), which is the one runner:
# it works for image-only deployments and Watchtower-driven updates, where
# start.sh is never invoked, and it refuses to start the app if a migration
# fails rather than serving against a half-applied schema.
#
# This function stays as `./start.sh migrate` — an explicit escape hatch for
# when the entrypoint could not run them (no POSTGRES_PASSWORD in the webapp
# environment) or when an operator wants to re-apply them without a restart.
# `up` no longer calls it: running it there meant two runners applying the
# same files concurrently, which collided (issue #152).
#
# ORDERING CONVENTION — migrations apply in alphabetical order (bash glob).
# That has two real implications when adding a new migration file:
#
#   1. If migration B depends on a table/column created in migration A
#      (e.g. `migration_vehicles_image.sql` ALTERs the `vehicles` table
#      that `migration_vehicles.sql` creates), B's filename must sort
#      AFTER A's. Use a `_<topic>` suffix matching the parent — Postgres'
#      ASCII has `.` (46) < `_` (95), so `migration_vehicles.sql` sorts
#      before `migration_vehicles_image.sql`. Subject suffixes that don't
#      share the parent prefix (e.g. `migration_unique_constraints.sql`)
#      can interleave, so check the resulting order with `ls migration*.sql`
#      before committing.
#
#   2. The unsuffixed `migration.sql` is the historical catch-all from
#      pre-1.0 — it sorts FIRST and folds in everything pre-dating the
#      `migration_<topic>.sql` convention. New migrations should always
#      use the `_<topic>` suffix; do not touch `migration.sql`.
#
# The entrypoint applies the same files in the same order. Keep the two in
# sync — this one exists so an operator is never locked out, not as a second
# opinion on what the schema should be.
run_migrations() {
  set +e
  local found=0 migration
  local -a failed=()
  for migration in migration*.sql; do
    [[ -f "$migration" ]] || continue
    found=1
    echo "→ $migration"
    # ON_ERROR_STOP so a broken statement fails its file instead of psql
    # shrugging and running the rest of it.
    docker exec -i "${PROJECT_NAME:-kinboard}-db" \
      psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$migration" || failed+=("$migration")
  done
  if [[ $found -eq 1 ]]; then
    docker exec "${PROJECT_NAME:-kinboard}-db" \
      psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema';" >/dev/null 2>&1 || true
    docker restart "${PROJECT_NAME:-kinboard}-rest" >/dev/null 2>&1 || true
  fi
  set -e

  # This used to discard every psql exit code, so a migration that failed
  # outright looked exactly like one that applied. Every file is still
  # attempted — one failure should not hide the rest — but the summary and the
  # non-zero exit are what make it visible.
  if [[ ${#failed[@]} -gt 0 ]]; then
    echo >&2
    echo "error: ${#failed[@]} migration(s) failed:" >&2
    printf '         %s\n' "${failed[@]}" >&2
    echo "       The schema is not what the app expects. Fix these before using the stack." >&2
    return 1
  fi
}

# Report on the migrations the webapp container runs at startup.
#
# `up` used to apply them from here, so the operator saw them scroll past and
# knew whether they worked. Now that the container is the only runner, this
# watches its log instead — same feedback, one runner.
wait_for_migrations() {
  local container="${PROJECT_NAME:-kinboard}-webapp"
  local i=0 logs="" since=""

  # Scope the log read to THIS run of the container. `docker logs` spans every
  # restart it has ever had, so on an already-running stack a previous boot's
  # success line matches immediately — and a genuinely failing new boot would
  # be reported as fine.
  since="$(docker inspect -f '{{.State.StartedAt}}' "$container" 2>/dev/null || true)"

  echo "→ migrations (applied by $container on startup)"
  while [[ $i -lt 180 ]]; do
    if [[ -n "$since" ]]; then
      logs="$(docker logs --since "$since" "$container" 2>&1 || true)"
    else
      logs="$(docker logs "$container" 2>&1 || true)"
    fi

    # Only a terminal give-up is an error. A single failed pass is expected on
    # a first boot — the Supabase services are creating their own schemas at
    # the same time and the two deadlock — and the entrypoint retries.
    if grep -q '\[entrypoint\] GIVING UP' <<<"$logs"; then
      echo >&2
      grep '\[entrypoint\]' <<<"$logs" | tail -20 >&2
      echo >&2
      echo "error: migrations failed; the webapp will not start against a half-applied schema." >&2
      echo "       Full output: docker logs $container" >&2
      return 1
    fi

    if grep -q '\[entrypoint\] POSTGRES_PASSWORD not set' <<<"$logs"; then
      echo "  warning: the webapp has no POSTGRES_PASSWORD, so it skipped migrations." >&2
      echo "           Apply them from here instead: ./start.sh migrate" >&2
      return 0
    fi

    if grep -q '\[entrypoint\] starting Next.js server' <<<"$logs"; then
      local retried
      retried="$(grep -c '\[entrypoint\] migration attempt ' <<<"$logs" || true)"
      if [[ ${retried:-0} -gt 0 ]]; then
        echo "  migrations applied after ${retried} retry/retries (normal on a first boot), schema cache reloaded"
      else
        echo "  migrations applied, schema cache reloaded"
      fi
      return 0
    fi

    sleep 2
    i=$((i + 1))
  done

  echo "  warning: the webapp had not finished its migrations after 6 minutes." >&2
  echo "           Check: docker logs $container" >&2
  return 0
}

case "$cmd" in
  up)
    # Say something when the stack is about to build the webapp from source
    # while a published image sits unused on this machine.
    #
    # That combination makes an upgrade quietly do nothing: compose rebuilds
    # whatever the source checkout is on, which for anyone who has not run
    # `git pull` is the version they already had. It reports success, the
    # containers come up healthy, and only the version in Settings disagrees
    # (issue #106). A warning, not a refusal — building from source on
    # purpose is a supported path.
    if ! $COMPOSE $COMPOSE_FILES config 2>/dev/null | grep -q 'image: ghcr.io/svenger87/kinboard'; then
      if docker image inspect "ghcr.io/svenger87/kinboard:${KINBOARD_TAG:-latest}" >/dev/null 2>&1; then
        echo "warning: the webapp will be BUILT FROM SOURCE, but the published image" >&2
        echo "         ghcr.io/svenger87/kinboard:${KINBOARD_TAG:-latest} is already on this machine." >&2
        echo "         To run the published image instead, load the overlay:" >&2
        echo "           COMPOSE_FILES=\"-f docker-compose.yml -f docker-compose.image.yml\" ./start.sh up" >&2
        echo "         To build on purpose, run 'git pull --ff-only origin main' first, or you" >&2
        echo "         will rebuild the version you are already running." >&2
      fi
    fi

    # The one-shot db-init service (docker-compose.yml) aligns role
    # passwords before auth/rest/storage/realtime start, so we just bring
    # the stack up and apply migrations.
    $COMPOSE $COMPOSE_FILES up -d
    wait_for_migrations
    $COMPOSE $COMPOSE_FILES ps
    ;;
  down)
    $COMPOSE $COMPOSE_FILES down
    ;;
  restart)
    $COMPOSE $COMPOSE_FILES build --no-cache webapp
    $COMPOSE $COMPOSE_FILES up -d --no-deps webapp
    $COMPOSE $COMPOSE_FILES up -d --no-deps --force-recreate cron
    ;;
  logs)
    shift || true
    $COMPOSE $COMPOSE_FILES logs -f --tail=200 "$@"
    ;;
  status|ps)
    $COMPOSE $COMPOSE_FILES ps
    ;;
  migrate)
    run_migrations
    ;;
  seed-demo)
    # Apply the optional demo dataset (gated — explicit opt-in).
    if [[ ! -f seed-demo.sql ]]; then
      echo "error: seed-demo.sql not found in $SCRIPT_DIR" >&2
      exit 1
    fi
    echo "→ seeding demo family (idempotent)"
    docker exec -i "${PROJECT_NAME:-kinboard}-db" \
      psql -U postgres -d postgres < seed-demo.sql
    ;;
  *)
    echo "unknown command: $cmd" >&2
    sed -n '4,16p' "$0"
    exit 2
    ;;
esac
