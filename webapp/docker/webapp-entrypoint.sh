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

# Root for the steps below that own files (moving uploads out of the old
# storage-api layout); the server itself never runs as root. An image run with
# `user:` set skips the file steps and starts as that user.
start_server() {
  if [ "$(id -u)" = "0" ]; then
    exec su-exec nextjs:nodejs node server.js
  fi
  exec node server.js
}

POSTGRES_HOST="${POSTGRES_HOST:-db}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-postgres}"

if [ -z "$POSTGRES_PASSWORD" ]; then
  echo "[entrypoint] POSTGRES_PASSWORD not set; skipping migrations." >&2
  echo "[entrypoint] Run 'webapp/docker/start.sh migrate' from the host or pass POSTGRES_PASSWORD via docker-compose env." >&2
  start_server
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
    start_server
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

# ---------------------------------------------------------------------------
# Realtime's replication slots (1.15).
#
# The supabase/realtime container held logical replication slots. A slot
# keeps every byte of WAL its consumer has not read, and with the consumer gone
# nothing reads it again: pg_wal grows until the disk is full and Postgres
# stops. So any slot realtime left behind is dropped once nothing is attached
# to it. One still in use (a stack whose compose file still runs realtime) is
# left alone. supabase_admin, because dropping a slot needs REPLICATION, which
# `postgres` lacks in this image; it shares POSTGRES_PASSWORD.
# ---------------------------------------------------------------------------
slots="$(psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U supabase_admin -d "$POSTGRES_DB" -tAq -v ON_ERROR_STOP=1 <<'SQL' 2>&1
SELECT slot_name || ' ' || pg_drop_replication_slot(slot_name)::text
  FROM pg_replication_slots
 WHERE slot_name LIKE 'supabase_realtime%' AND NOT active;
SQL
)" || echo "[entrypoint] could not check for realtime's replication slots: $slots" >&2
for slot in $slots; do
  case "$slot" in supabase_realtime*) echo "[entrypoint] dropped replication slot $slot (realtime is gone)" ;; esac
done

# ---------------------------------------------------------------------------
# Files from storage-api (1.15).
#
# Uploaded files now live at $FILES_DIR/<bucket>/<key> (lib/files/store.ts).
# storage-api kept each object at <volume>/stub/stub/<bucket>/<key>/<version>,
# with the version recorded in storage.objects. FILES_DIR sits inside that same
# volume, so each object is hard-linked across: no copy, no extra disk, and
# the old tree stays as it was in case anything has to be rolled back. Only
# when a link is impossible is the file copied.
#
# Once, then never again: a marker file records the move. Objects already at
# their new path are skipped, so an interrupted run simply continues. An
# object whose file is missing is reported and skipped — it was already a
# broken image before the move.
# ---------------------------------------------------------------------------
migrate_files() {
  [ -n "${FILES_DIR:-}" ] || return 0
  if [ "$(id -u)" != "0" ]; then
    [ -d "$FILES_DIR" ] || echo "[entrypoint] FILES_DIR $FILES_DIR does not exist and this container is not root; uploads will fail" >&2
    return 0
  fi
  mkdir -p "$FILES_DIR"
  chown nextjs:nodejs "$FILES_DIR"

  marker="$FILES_DIR/.moved-from-storage-api"
  [ -f "$marker" ] && return 0

  legacy="$(dirname "$FILES_DIR")"
  has_objects="$(psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAq \
                 -c "SELECT to_regclass('storage.objects') IS NOT NULL" 2>/dev/null || true)"
  if [ "$has_objects" = "f" ]; then
    # No storage schema at all: an install that never had storage-api.
    date -u +%FT%TZ >"$marker"
    return 0
  fi
  list="$(mktemp)"
  if [ "$has_objects" != "t" ] || ! psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
       -tAq -F "$(printf '\t')" -v ON_ERROR_STOP=1 >"$list" <<'SQL'
SELECT bucket_id, name, coalesce(version, '')
  FROM storage.objects
 WHERE name NOT LIKE '%/.emptyFolderPlaceholder' AND name <> '.emptyFolderPlaceholder';
SQL
  then
    # No marker: the next start tries again.
    echo "[entrypoint] could not list storage-api's objects; uploaded files not moved yet (retried on the next start)" >&2
    rm -f "$list"
    return 0
  fi

  moved=0; present=0; missing=0
  tab="$(printf '\t')"
  while IFS="$tab" read -r bucket name version; do
    [ -n "$bucket" ] && [ -n "$name" ] || continue
    case "/$bucket/$name/" in
      */../* | */./* | *//*) echo "[entrypoint] skipping object with an unsafe name: $bucket/$name" >&2; continue ;;
    esac
    dst="$FILES_DIR/$bucket/$name"
    if [ -e "$dst" ]; then present=$((present + 1)); continue; fi
    src=""
    for candidate in "$legacy/stub/stub/$bucket/$name/$version" "$legacy/stub/$bucket/$name/$version" \
                     "$legacy/stub/stub/$bucket/$name" "$legacy/stub/$bucket/$name"; do
      if [ -f "$candidate" ]; then src="$candidate"; break; fi
    done
    if [ -z "$src" ]; then
      echo "[entrypoint] storage object has no file on disk, skipped: $bucket/$name" >&2
      missing=$((missing + 1))
      continue
    fi
    mkdir -p "$(dirname "$dst")"
    ln "$src" "$dst" 2>/dev/null || cp -p "$src" "$dst"
    moved=$((moved + 1))
  done <"$list"
  rm -f "$list"

  chown -R nextjs:nodejs "$FILES_DIR"
  printf '%s moved=%s present=%s missing=%s\n' "$(date -u +%FT%TZ)" "$moved" "$present" "$missing" >"$marker"
  echo "[entrypoint] uploaded files moved out of storage-api: $moved moved, $present already there, $missing missing"
}
migrate_files

unset PGPASSWORD

echo "[entrypoint] starting Next.js server"
start_server
