#!/bin/sh
# webapp-entrypoint.sh — applied as the runner stage's ENTRYPOINT.
#
# Runs migration*.sql against the db before exec'ing the Next.js server.
# Each migration file uses IF NOT EXISTS / IF EXISTS guards so re-running
# is a no-op — safe to fire on every container start, which is exactly
# what we need for Watchtower-driven updates: pulling a new webapp image
# with new migrations baked in DOES apply them automatically.
#
# Two parallel paths apply migrations:
#   1. Host-driven: webapp/docker/start.sh's run_migrations() loops the
#      same files via `docker exec ... < migration.sql` from the host.
#      That path remains supported for operators who run start.sh.
#   2. Container-driven: this script. Watchtower-driven and fresh-image
#      flows hit this path automatically.
# Keep both paths in sync — they apply identical files in the same order.
#
# Env vars (passed by docker-compose.yml's webapp service):
#   POSTGRES_HOST     defaults to "db" (the docker service name)
#   POSTGRES_PORT     defaults to "5432"
#   POSTGRES_USER     defaults to "postgres"
#   POSTGRES_DB       defaults to "postgres"
#   POSTGRES_PASSWORD required — passed from .env

set -e

POSTGRES_HOST="${POSTGRES_HOST:-db}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-postgres}"

if [ -z "$POSTGRES_PASSWORD" ]; then
  echo "[entrypoint] POSTGRES_PASSWORD not set; skipping migrations." >&2
  echo "[entrypoint] Run 'webapp/docker/start.sh migrate' from the host or pass POSTGRES_PASSWORD via docker-compose env." >&2
  exec node server.js
fi

export PGPASSWORD="$POSTGRES_PASSWORD"

# Wait for db to be reachable. Cap at ~60s — if it's not up by then,
# something is wrong upstream and we should fail fast rather than spin
# forever in a restart loop.
echo "[entrypoint] waiting for postgres at ${POSTGRES_HOST}:${POSTGRES_PORT} (max 60s)..."
i=0
until pg_isready -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ $i -gt 30 ]; then
    echo "[entrypoint] postgres still unreachable after 60s; starting webapp anyway (it will retry on its own connections)." >&2
    exec node server.js
  fi
  sleep 2
done
echo "[entrypoint] postgres reachable."

# Apply migrations in alphabetical order. Each file's idempotency guards
# (IF NOT EXISTS / DO blocks with information_schema checks) keep
# re-runs safe.
MIGRATIONS_DIR="/app/migrations"
if [ -d "$MIGRATIONS_DIR" ]; then
  for migration in "$MIGRATIONS_DIR"/migration*.sql; do
    [ -f "$migration" ] || continue
    name="$(basename "$migration")"
    echo "[entrypoint] applying $name"
    if ! psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
              -v ON_ERROR_STOP=1 -f "$migration"; then
      echo "[entrypoint] FAILED: $name — refusing to start webapp with stale schema." >&2
      exit 1
    fi
  done
  # Tell PostgREST to reload its schema cache so newly-added columns
  # become queryable without a separate restart.
  psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
       -c "NOTIFY pgrst, 'reload schema';" >/dev/null 2>&1 || true
else
  echo "[entrypoint] no migrations directory at $MIGRATIONS_DIR; skipping."
fi

unset PGPASSWORD

echo "[entrypoint] starting Next.js server"
exec node server.js
