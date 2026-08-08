#!/bin/sh
# webapp-entrypoint.sh — applied as the runner stage's ENTRYPOINT.
#
# Runs migration*.sql against the db before exec'ing the Next.js server.
# Each migration file uses IF NOT EXISTS / IF EXISTS guards so re-running
# is a no-op — safe to fire on every container start, which is exactly
# what we need for Watchtower-driven updates: pulling a new webapp image
# with new migrations baked in DOES apply them automatically.
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

# Apply migrations in alphabetical order. Each file's idempotency guards
# (IF NOT EXISTS / DO blocks with information_schema checks) keep
# re-runs safe.
MIGRATIONS_DIR="/app/migrations"

# Wait for the storage service to have created its schema, because three
# migrations create image buckets in it. They are guarded, so they skip rather
# than fail if it is not there — which on a fresh install would mean recipe,
# goal and vehicle image uploads are broken until the next container start.
# Waiting here makes a first boot come up complete instead of nearly complete.
#
# Bounded, and not fatal: a stack running without the storage service is a
# supported thing to do, and the guards cover it.
echo "[entrypoint] waiting for the storage schema (max 60s)..."
i=0
until [ "$(psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
                -tAc "SELECT to_regclass('storage.buckets') IS NOT NULL" 2>/dev/null)" = "t" ]; do
  i=$((i + 1))
  if [ $i -gt 30 ]; then
    echo "[entrypoint] storage schema not there after 60s; continuing (image buckets will be created on a later start)." >&2
    break
  fi
  sleep 2
done

# Wait for realtime to finish claiming its tables, for the same reason as the
# storage wait above — except this one is about correctness of the *first*
# attempt rather than completeness.
#
# On startup realtime adds every replicated public table to its publications
# and creates two logical replication slots. Adding a table locks it; creating
# a slot waits for every in-flight transaction to drain. The policy block in
# migration.sql drops and recreates policies on those same tables, which needs
# an AccessExclusiveLock. Interleave the two and Postgres breaks the cycle by
# killing one of them:
#
#   psql:/app/migrations/migration.sql:143: ERROR:  deadlock detected
#   DETAIL: Process 267 waits for AccessExclusiveLock on relation 18004 ...
#           Process 261 waits for ShareLock on virtual transaction 15/112 ...
#
# Measured over a 20-run fresh-install loop before this wait existed: 5 of 20
# first attempts died exactly there, on public.recipes / recipe_ingredients —
# both of which are in realtime's publication. Every one recovered on the
# retry below, so nothing was ever broken; but a 25% first-boot failure rate
# writes a deadlock and a stack trace into the log of a brand-new install,
# which is indistinguishable from a migration that is genuinely wrong.
#
# Bounded and not fatal, because a stack without realtime is supported.
echo "[entrypoint] waiting for realtime to claim its tables (max 40s)..."
i=0
until [ "$(psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
                -tAc "SELECT count(*) > 0 FROM pg_replication_slots WHERE slot_name LIKE 'supabase_realtime%'" 2>/dev/null)" = "t" ]; do
  i=$((i + 1))
  if [ $i -gt 20 ]; then
    echo "[entrypoint] no realtime replication slot after 40s; continuing (realtime may not be deployed)." >&2
    break
  fi
  sleep 2
done

# Retained as a backstop. The wait above removes the common cause, but the
# services still start concurrently and a slower box can still lose a race —
# and without a retry the container exits, Docker restarts it, and it succeeds
# anyway by way of a crash-loop, which reads exactly like a broken schema.
MIGRATION_ATTEMPTS="${MIGRATION_ATTEMPTS:-6}"

apply_migrations() {
  for migration in "$MIGRATIONS_DIR"/migration*.sql; do
    [ -f "$migration" ] || continue
    name="$(basename "$migration")"
    echo "[entrypoint] applying $name"
    if ! psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
              -v ON_ERROR_STOP=1 -f "$migration"; then
      echo "[entrypoint] FAILED: $name" >&2
      return 1
    fi
  done
  return 0
}

if [ -d "$MIGRATIONS_DIR" ]; then
  attempt=1
  until apply_migrations; do
    if [ "$attempt" -ge "$MIGRATION_ATTEMPTS" ]; then
      echo "[entrypoint] GIVING UP after $attempt attempts — refusing to start webapp with stale schema." >&2
      exit 1
    fi
    echo "[entrypoint] migration attempt $attempt failed; retrying in 5s (the other services may still be initialising)" >&2
    attempt=$((attempt + 1))
    sleep 5
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
