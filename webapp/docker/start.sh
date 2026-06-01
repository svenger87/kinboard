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

# Apply every webapp/docker/migration*.sql to the running DB.
# Each migration file uses `IF NOT EXISTS` / `IF EXISTS` guards so re-running
# is a no-op. We call this from `up` so a fresh install gets the full schema
# (init.sql only ships the original tables; later migrations add columns the
# webapp depends on, e.g. devices.hardware_id / devices.fingerprint, and
# tables like recipes / meals / notification_preferences / vehicles).
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
# This same loop is duplicated in webapp-entrypoint.sh — when migrations
# are baked into the webapp Docker image, the entrypoint applies them on
# container start so Watchtower-driven updates pick up new schema without
# the operator running `start.sh migrate` manually. Keep the two in sync.
run_migrations() {
  set +e
  local found=0 migration
  for migration in migration*.sql; do
    [[ -f "$migration" ]] || continue
    found=1
    echo "→ $migration"
    docker exec -i "${PROJECT_NAME:-kinboard}-db" \
      psql -U postgres -d postgres < "$migration"
  done
  if [[ $found -eq 1 ]]; then
    docker exec "${PROJECT_NAME:-kinboard}-db" \
      psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema';" >/dev/null 2>&1 || true
    docker restart "${PROJECT_NAME:-kinboard}-rest" >/dev/null 2>&1 || true
  fi
  set -e
}

case "$cmd" in
  up)
    # The one-shot db-init service (docker-compose.yml) aligns role
    # passwords before auth/rest/storage/realtime start, so we just bring
    # the stack up and apply migrations.
    $COMPOSE $COMPOSE_FILES up -d
    run_migrations
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
