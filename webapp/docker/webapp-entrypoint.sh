#!/bin/sh
# webapp-entrypoint.sh — applied as the runner stage's ENTRYPOINT.
#
# Applies migrations/NNN_*.sql (through migrate.sh) before exec'ing the
# Next.js server, so pulling a new image with new migrations baked in applies
# them automatically: Diun, Watchtower, a manual pull — anything.
#
# THIS IS THE ONLY THING THAT APPLIES MIGRATIONS AUTOMATICALLY.
#
# start.sh used to apply the same files from the host during `up`, at the same
# time as this ran. The two collided — one creating a table between the other's
# IF NOT EXISTS check and its CREATE, and the storage service taking ownership
# of its tables mid-run (issue #152). Since this path is the one that works
# everywhere (image-only deployments, Watchtower updates, anything that never
# invokes start.sh), it is the one that stayed. `./start.sh migrate` remains as
# an explicit manual escape hatch; `start.sh up` now watches this log instead
# of racing it.
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

# The migrations. migrate.sh applies each numbered file it has not applied
# before (or whose content changed) and records it in
# kinboard.schema_migrations; a boot with nothing new runs no migration SQL.
MIGRATIONS_DIR="/app/migrations"

# Retained as a backstop for a first boot, where the database may still be
# finishing its own init scripts when this starts. Without a retry the
# container exits, Docker restarts it, and it succeeds anyway by way of a
# crash-loop, which reads exactly like a broken schema.
MIGRATION_ATTEMPTS="${MIGRATION_ATTEMPTS:-6}"

if [ -d "$MIGRATIONS_DIR" ]; then
  attempt=1
  until MIGRATIONS_DIR="$MIGRATIONS_DIR" sh /app/migrate.sh; do
    if [ "$attempt" -ge "$MIGRATION_ATTEMPTS" ]; then
      echo "[entrypoint] GIVING UP after $attempt attempts — refusing to start webapp with stale schema." >&2
      exit 1
    fi
    echo "[entrypoint] migration attempt $attempt failed; retrying in 5s (the database may still be initialising)" >&2
    attempt=$((attempt + 1))
    sleep 5
  done

  # The server's own time zone, for the database's "today" when a family has
  # not picked one (#341) -- the zone the rest of the server already falls
  # back to. Passed as a psql variable, never pasted into the SQL; kept only
  # when Postgres knows the zone, and cleared when TZ is unset or unknown, so
  # the database falls back exactly where lib/family-time.ts does.
  if ! psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
            -v ON_ERROR_STOP=1 -v tz="${TZ:-}" -q >/dev/null <<'SQL'
DELETE FROM public.instance_settings
 WHERE key = 'server_timezone' AND NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = :'tz');
INSERT INTO public.instance_settings (key, value)
SELECT 'server_timezone', :'tz' WHERE EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = :'tz')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
SQL
  then
    echo "[entrypoint] could not record the server's time zone; the database falls back to Europe/Berlin" >&2
  fi
else
  echo "[entrypoint] no migrations directory at $MIGRATIONS_DIR; skipping."
fi

unset PGPASSWORD

echo "[entrypoint] starting Next.js server"
exec node server.js
